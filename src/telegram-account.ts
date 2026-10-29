import type { GenericEndpointContext } from "@better-auth/core";
import { runWithTransaction } from "@better-auth/core/context";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import { createPlaceholderEmail } from "@better-auth/core/utils/email";
import type { Account, Session, User } from "better-auth";
import { APIError, isAPIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
  parseAdditionalUserInputFromProviderProfile,
  parseSessionOutput,
  parseUserOutput,
} from "better-auth/db";
import { ERROR_CODES, PLUGIN_ID, TELEGRAM_OIDC_PROVIDER_ID } from "./constants";
import { reconcileTelegramIdentity } from "./telegram-identity";

/** A Telegram user proven by a verified Login Widget or Mini App payload. */
export interface TelegramIdentity {
  /** Telegram user id as a string. */
  telegramId: string;
  username?: string | undefined;
}

/** Provisioning method reported to `user.validateUserInfo`. */
export type TelegramProvisioningMethod =
  | "telegram-login-widget"
  | "telegram-mini-app";

interface UserData {
  email?: string | null | undefined;
  emailVerified?: boolean | undefined;
  image?: string | null | undefined;
  name?: string | undefined;
  [key: string]: unknown;
}

type TelegramUser = User & {
  telegramId?: string | null;
  telegramPhoneNumber?: string | null;
  telegramUsername?: string | null;
};

type TelegramAccount = Account & {
  telegramId?: string | null;
  telegramUsername?: string | null;
};

function accountData(userId: string, identity: TelegramIdentity) {
  return {
    userId,
    providerId: PLUGIN_ID,
    accountId: identity.telegramId,
    telegramId: identity.telegramId,
    telegramUsername: identity.username,
  };
}

function findUserByTelegramId(ctx: GenericEndpointContext, telegramId: string) {
  return ctx.context.adapter.findOne<TelegramUser>({
    model: "user",
    where: [{ field: "telegramId", value: telegramId }],
  });
}

async function hasLinkedTelegramIdentity(
  ctx: GenericEndpointContext,
  userId: string,
  telegramId: string
) {
  // A vetoed identity update can leave stale profile fields after an unlink.
  // Only a linked account, never the cached profile field alone, grants access.
  const accounts = (await ctx.context.internalAdapter.findAccounts(
    userId
  )) as TelegramAccount[];
  return accounts.some(
    (account) =>
      (account.providerId === PLUGIN_ID && account.accountId === telegramId) ||
      (account.providerId === TELEGRAM_OIDC_PROVIDER_ID &&
        account.telegramId === telegramId)
  );
}

/**
 * Looks the account up with `findOne` rather than Better Auth's
 * `findAccountByKey`, which throws when older versions left duplicate rows.
 */
function findTelegramAccount(ctx: GenericEndpointContext, telegramId: string) {
  return ctx.context.adapter.findOne<TelegramAccount>({
    model: "account",
    where: [
      { field: "providerId", value: PLUGIN_ID },
      { field: "accountId", value: telegramId },
    ],
  });
}

/**
 * Runs the app's `user.validateUserInfo` gate for actions Better Auth's
 * internal adapter does not cover (`create-user` is checked by `createUser`).
 * Fails closed, like Better Auth's own gate.
 */
async function assertValidUserInfo(
  ctx: GenericEndpointContext,
  user: TelegramUser,
  action: "sign-in" | "link-account",
  method: TelegramProvisioningMethod
) {
  const validate = ctx.context.options.user?.validateUserInfo;
  if (!validate) {
    return;
  }
  let result: Awaited<ReturnType<typeof validate>>;
  try {
    result = await validate({ user, source: { method, action } }, ctx);
  } catch (error) {
    ctx.context.logger.error("validateUserInfo callback threw", error);
    throw new APIError("FORBIDDEN", {
      code: "validation_failed",
      message: "User validation failed",
      cause: error,
    });
  }
  if (result?.error) {
    throw new APIError("FORBIDDEN", {
      code: result.error,
      message: result.errorDescription || result.error,
    });
  }
}

/** Keeps the stored Telegram username current (it can change at any time). */
async function refreshIdentity(
  ctx: GenericEndpointContext,
  user: TelegramUser,
  account: TelegramAccount,
  identity: TelegramIdentity
): Promise<TelegramUser> {
  // SQL adapters return null for a missing username, the identity has undefined.
  const username = identity.username ?? null;
  if ((account.telegramUsername ?? null) !== username) {
    await ctx.context.internalAdapter.updateAccount(account.id, {
      telegramUsername: username,
    } as Partial<Account>);
  }
  const userUpdate: Partial<TelegramUser> = {};
  if (!user.telegramId) {
    userUpdate.telegramId = identity.telegramId;
  }
  if (
    (!user.telegramId || user.telegramId === identity.telegramId) &&
    (user.telegramUsername ?? null) !== username
  ) {
    userUpdate.telegramUsername = username;
  }
  if (Object.keys(userUpdate).length === 0) {
    return user;
  }
  return (
    ((await ctx.context.internalAdapter.updateUser(
      user.id,
      userUpdate
    )) as TelegramUser | null) ?? user
  );
}

/** Identity and user operations in progress, per Better Auth instance. */
const inProgress = new WeakMap<object, Map<string, Promise<unknown>>>();

/**
 * Runs `task` once every earlier task for the same operation key on this
 * Better Auth instance has settled. A double-submitted first sign-in (React
 * strict mode, a double click) would otherwise create the user twice, or
 * link a second account to the user the first request just created.
 */
async function oneAtATime<T>(
  ctx: GenericEndpointContext,
  operationKey: string,
  task: () => Promise<T>
): Promise<T> {
  const key = ctx.context.adapter;
  let tasks = inProgress.get(key);
  if (!tasks) {
    tasks = new Map();
    inProgress.set(key, tasks);
  }
  const current = (tasks.get(operationKey) ?? Promise.resolve()).then(task);
  const settled = current.then(
    () => undefined,
    () => undefined
  );
  tasks.set(operationKey, settled);
  try {
    return await current;
  } finally {
    if (tasks.get(operationKey) === settled) {
      tasks.delete(operationKey);
    }
  }
}

/** Signs a returning Telegram user in through their `telegram` account. */
async function signInWithAccount(
  ctx: GenericEndpointContext,
  account: TelegramAccount,
  identity: TelegramIdentity,
  method: TelegramProvisioningMethod
): Promise<TelegramUser> {
  const user = (await ctx.context.internalAdapter.findUserById(
    account.userId
  )) as TelegramUser | null;
  if (!user) {
    throw APIError.from("INTERNAL_SERVER_ERROR", ERROR_CODES.ORPHANED_ACCOUNT);
  }
  await assertValidUserInfo(
    ctx,
    { ...user, telegramUsername: identity.username ?? null },
    "sign-in",
    method
  );
  return await refreshIdentity(ctx, user, account, identity);
}

/**
 * Finds the user for a verified Telegram identity, linking or creating the
 * Telegram account when needed:
 *
 * 1. an account `telegram/<id>` → its user;
 * 2. a user with this `telegramId` (Mini App, Login Widget or OIDC) → link;
 * 3. otherwise create the user and account, when `allowCreate` is set.
 *
 * Writes go through Better Auth's internal adapter, so `databaseHooks` apply,
 * and `user.validateUserInfo` sees every sign-in, link and sign-up.
 */
export async function findOrCreateTelegramUser(
  ctx: GenericEndpointContext,
  options: {
    identity: TelegramIdentity;
    userData: UserData;
    allowCreate: boolean;
    method: TelegramProvisioningMethod;
    notFound: (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
  }
): Promise<TelegramUser> {
  return await oneAtATime(ctx, `telegram:${options.identity.telegramId}`, () =>
    findOrCreate(ctx, options)
  );
}

async function findOrCreate(
  ctx: GenericEndpointContext,
  options: Parameters<typeof findOrCreateTelegramUser>[1]
): Promise<TelegramUser> {
  const { identity, method } = options;
  const { internalAdapter } = ctx.context;

  const account = await findTelegramAccount(ctx, identity.telegramId);
  if (account) {
    return await signInWithAccount(ctx, account, identity, method);
  }

  const existingUser = await findUserByTelegramId(ctx, identity.telegramId);
  if (
    existingUser &&
    (await hasLinkedTelegramIdentity(ctx, existingUser.id, identity.telegramId))
  ) {
    // Another server's first sign-in may have committed this user (and, in
    // the same transaction, the account) since the lookup above.
    const committed = await findTelegramAccount(ctx, identity.telegramId);
    if (committed) {
      return await signInWithAccount(ctx, committed, identity, method);
    }
    // Same rule as Better Auth's OAuth sign-in linking to an existing user.
    const accountLinking = ctx.context.options.account?.accountLinking;
    if (
      accountLinking?.enabled === false ||
      accountLinking?.disableImplicitLinking === true
    ) {
      throw APIError.from("UNAUTHORIZED", ERROR_CODES.ACCOUNT_NOT_LINKED);
    }
    await assertValidUserInfo(ctx, existingUser, "link-account", method);
    return await oneAtATime(ctx, `user:${existingUser.id}`, () =>
      runWithTransaction(ctx.context.adapter, async () => {
        const linked = await internalAdapter.linkAccount(
          accountData(existingUser.id, identity)
        );
        if (!linked) {
          throw APIError.from(
            "FORBIDDEN",
            ERROR_CODES.ACCOUNT_CREATION_REJECTED
          );
        }
        return await refreshIdentity(
          ctx,
          existingUser,
          linked as TelegramAccount,
          identity
        );
      })
    );
  }

  if (!options.allowCreate) {
    throw APIError.from("NOT_FOUND", options.notFound);
  }

  let email = signUpEmail(options.userData, identity);
  if (await internalAdapter.findUserByEmail(email)) {
    // Either another server just created this Telegram user (sign in as
    // them), the placeholder stayed with a user who unlinked this Telegram
    // account (sign up with another reserved placeholder), or a mapper
    // returned someone else's email: refuse it like Better Auth's
    // /sign-up/email does.
    const created = await findTelegramAccount(ctx, identity.telegramId);
    if (created) {
      return await signInWithAccount(ctx, created, identity, method);
    }
    if ((options.userData.email ?? null) !== null) {
      throw APIError.from(
        "UNPROCESSABLE_ENTITY",
        BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL
      );
    }
    email = createPlaceholderEmail({
      identifier: `${identity.telegramId}.${randomSuffix()}`,
      namespace: PLUGIN_ID,
    });
  }

  try {
    return await createTelegramUser(ctx, options, email);
  } catch (error) {
    // Another server created this Telegram user a moment earlier, and the
    // database refused our copy (unique email): sign in as that user.
    const created = isAPIError(error)
      ? null
      : await findTelegramAccount(ctx, identity.telegramId);
    if (!created) {
      throw error;
    }
    return await signInWithAccount(ctx, created, identity, method);
  }
}

/** Eight lowercase base-36 characters. */
function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

/** A mapper's email, or the placeholder (Better Auth's user.email is required). */
function signUpEmail(userData: UserData, identity: TelegramIdentity): string {
  return (
    userData.email ??
    createPlaceholderEmail({
      identifier: identity.telegramId,
      namespace: PLUGIN_ID,
    })
  );
}

/**
 * Creates the user and their `telegram` account, in a transaction. Mapper
 * output goes through Better Auth's provider-profile parsing, as OAuth
 * sign-ups do: no `id`, no `emailVerified` (nothing verified the mapper's
 * email), no `input: false` or unknown fields.
 */
async function createTelegramUser(
  ctx: GenericEndpointContext,
  options: Parameters<typeof findOrCreateTelegramUser>[1],
  email: string
): Promise<TelegramUser> {
  const { identity, method } = options;
  const { internalAdapter } = ctx.context;
  const {
    id: _id,
    email: _email,
    emailVerified: _emailVerified,
    name,
    image,
    ...profile
  } = options.userData;
  return await runWithTransaction(ctx.context.adapter, async () => {
    const user = (await internalAdapter.createUser(
      {
        ...parseAdditionalUserInputFromProviderProfile(
          ctx.context.options,
          profile,
          "create"
        ),
        name: name ?? "",
        image,
        email,
        emailVerified: false,
        telegramId: identity.telegramId,
        telegramUsername: identity.username,
      },
      { method }
    )) as TelegramUser | null;
    if (!user) {
      // A database hook vetoed the creation.
      throw APIError.from("FORBIDDEN", ERROR_CODES.USER_CREATION_REJECTED);
    }
    const account = await internalAdapter.createAccount(
      accountData(user.id, identity)
    );
    if (!account) {
      throw APIError.from("FORBIDDEN", ERROR_CODES.ACCOUNT_CREATION_REJECTED);
    }
    return user;
  });
}

/**
 * Creates a session for `user`, sets the session cookie and answers with
 * both, filtered like Better Auth's own sign-in responses (no
 * `returned: false` fields).
 */
export async function startSession(
  ctx: GenericEndpointContext,
  user: TelegramUser
) {
  const session = await ctx.context.internalAdapter.createSession(user.id);
  if (!session) {
    // A database hook vetoed it; Better Auth's /sign-in/email answers the same.
    throw APIError.from(
      "UNAUTHORIZED",
      BASE_ERROR_CODES.FAILED_TO_CREATE_SESSION
    );
  }
  await setSessionCookie(ctx, { session, user });
  return ctx.json({
    user: parseUserOutput(ctx.context.options, user),
    session: parseSessionOutput(ctx.context.options, session),
  });
}

/**
 * Re-issues the session cookie with the user as stored now, like Better
 * Auth's /update-user, so `session.cookieCache` doesn't keep serving the
 * Telegram identity from before a link or unlink.
 */
export async function refreshSessionCookie(
  ctx: GenericEndpointContext,
  session: { session: Session; user: User }
) {
  const user = await ctx.context.internalAdapter.findUserById(session.user.id);
  if (user) {
    await setSessionCookie(ctx, { session: session.session, user });
  }
}

/**
 * Links a verified Telegram identity to the signed-in user. A user has at
 * most one Telegram identity: linking a different one is refused.
 */
export async function linkTelegramAccount(
  ctx: GenericEndpointContext,
  user: TelegramUser,
  identity: TelegramIdentity
) {
  // Lock identity first, then user: distinct identities must not both link
  // before either request has persisted this user's current identity.
  await oneAtATime(ctx, `telegram:${identity.telegramId}`, () =>
    oneAtATime(ctx, `user:${user.id}`, () => link(ctx, user, identity))
  );
}

async function link(
  ctx: GenericEndpointContext,
  user: TelegramUser,
  identity: TelegramIdentity
) {
  const account = await findTelegramAccount(ctx, identity.telegramId);
  if (account) {
    throw APIError.from(
      "CONFLICT",
      account.userId === user.id
        ? ERROR_CODES.TELEGRAM_ALREADY_LINKED_SELF
        : ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER
    );
  }

  const owner = await findUserByTelegramId(ctx, identity.telegramId);
  if (owner && owner.id !== user.id) {
    throw APIError.from("CONFLICT", ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER);
  }

  const current = (await ctx.context.internalAdapter.findUserById(
    user.id
  )) as TelegramUser | null;
  if (current?.telegramId && current.telegramId !== identity.telegramId) {
    throw APIError.from(
      "CONFLICT",
      ERROR_CODES.DIFFERENT_TELEGRAM_ACCOUNT_LINKED
    );
  }

  await assertValidUserInfo(
    ctx,
    current ?? user,
    "link-account",
    "telegram-login-widget"
  );

  await runWithTransaction(ctx.context.adapter, async () => {
    const linked = await ctx.context.internalAdapter.linkAccount(
      accountData(user.id, identity)
    );
    if (!linked) {
      throw APIError.from("FORBIDDEN", ERROR_CODES.ACCOUNT_CREATION_REJECTED);
    }
    const updated = await ctx.context.internalAdapter.updateUser(user.id, {
      telegramId: identity.telegramId,
      telegramUsername: identity.username ?? null,
    });
    if (!updated) {
      throw APIError.from("FORBIDDEN", ERROR_CODES.IDENTITY_UPDATE_REJECTED);
    }
  });
}

/**
 * Removes the Login Widget / Mini App account from the signed-in user.
 * Refuses to remove the user's only account unless Better Auth's
 * `account.accountLinking.allowUnlinkingAll` is set. The Telegram identity
 * on the user is re-checked by the `account.delete` hook.
 */
export async function unlinkTelegramAccount(
  ctx: GenericEndpointContext,
  userId: string
) {
  return await oneAtATime(ctx, `user:${userId}`, () =>
    runWithTransaction(ctx.context.adapter, () => unlink(ctx, userId))
  );
}

async function unlink(ctx: GenericEndpointContext, userId: string) {
  const { internalAdapter } = ctx.context;
  const accounts = await internalAdapter.findAccounts(userId);
  // Every row: a duplicate (left by v2 or a cross-server race) would keep
  // proving user.telegramId, and the unlinked user could still sign in.
  const telegramAccounts = accounts.filter(
    (account) => account.providerId === PLUGIN_ID
  );
  if (telegramAccounts.length === 0) {
    throw APIError.from("NOT_FOUND", ERROR_CODES.NOT_LINKED);
  }

  const allowUnlinkingAll =
    ctx.context.options.account?.accountLinking?.allowUnlinkingAll === true;
  if (accounts.length === telegramAccounts.length && !allowUnlinkingAll) {
    throw APIError.from("BAD_REQUEST", ERROR_CODES.CANNOT_UNLINK_LAST_ACCOUNT);
  }

  await Promise.all(
    telegramAccounts.map((account) => internalAdapter.deleteAccount(account.id))
  );
  const remaining = await internalAdapter.findAccounts(userId);
  if (remaining.some((account) => account.providerId === PLUGIN_ID)) {
    throw APIError.from("FORBIDDEN", ERROR_CODES.ACCOUNT_UNLINK_REJECTED);
  }
  // The hook also runs this; calling it here keeps the response consistent
  // even when the delete hook is deferred until after a transaction.
  await reconcileTelegramIdentity(ctx.context, userId);
}
