import type { AuthContext, BetterAuthOptions } from "@better-auth/core";
import {
  defineRequestState,
  getCurrentAdapter,
  hasRequestState,
  runWithTransaction,
} from "@better-auth/core/context";
import type { Account, User } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
  parseAdditionalUserInputFromProviderProfile,
  parseUserOutput,
} from "better-auth/db";
import {
  ERROR_CODES,
  PLACEHOLDER_EMAIL_DOMAINS,
  PLUGIN_ID,
  TELEGRAM_OIDC_PROVIDER_ID,
} from "./constants";
import type { TelegramOIDCClaims } from "./types";

interface VerifiedSignIn {
  /** Users this request changed after Better Auth read them. */
  changedUserIds: Set<string>;
  claims: TelegramOIDCClaims;
  /** The user info `getUserInfo` gave Better Auth (mapper output included). */
  userInfo: Record<string, unknown>;
}

/**
 * The Telegram ID token verified during the current request. Set by the
 * OIDC provider's `getUserInfo`, read by the hooks below.
 */
const verifiedSignIn = defineRequestState<VerifiedSignIn | null>(() => null);

export async function rememberVerifiedClaims(
  claims: TelegramOIDCClaims,
  userInfo: Record<string, unknown>
) {
  if (await hasRequestState()) {
    await verifiedSignIn.set({ claims, userInfo, changedUserIds: new Set() });
  }
}

async function currentSignIn() {
  return (await hasRequestState()) ? await verifiedSignIn.get() : null;
}

async function currentClaims() {
  return (await currentSignIn())?.claims ?? null;
}

async function markChanged(userId: string) {
  (await currentSignIn())?.changedUserIds.add(userId);
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

const TELEGRAM_PROVIDERS = new Set([PLUGIN_ID, TELEGRAM_OIDC_PROVIDER_ID]);

/**
 * `<identifier>@<namespace>.placeholder.invalid` addresses are the plugin's.
 * Returns the identifier when `email` is one of them.
 */
function placeholderIdentifier(
  email: unknown
): { identifier: string; namespace: string } | null {
  if (typeof email !== "string") {
    return null;
  }
  const lower = email.toLowerCase();
  for (const [namespace, domain] of Object.entries(PLACEHOLDER_EMAIL_DOMAINS)) {
    if (lower.endsWith(`@${domain}`)) {
      return { identifier: lower.slice(0, -domain.length - 1), namespace };
    }
  }
  return null;
}

/**
 * Only the Telegram flows may create users with Telegram placeholder emails:
 * otherwise anyone could register `<telegramId>@telegram.placeholder.invalid`
 * with a password and block (or pre-claim) that Telegram user's account.
 */
async function isAllowedPlaceholder(user: Record<string, unknown>) {
  const placeholder = placeholderIdentifier(user.email);
  if (!placeholder) {
    return true;
  }
  if (placeholder.namespace === PLUGIN_ID) {
    // `<id>` or, after the user holding `<id>` unlinked Telegram, `<id>.<suffix>`.
    const telegramId = String(user.telegramId ?? "");
    return (
      telegramId !== "" &&
      (placeholder.identifier === telegramId ||
        placeholder.identifier.startsWith(`${telegramId}.`))
    );
  }
  const claims = await currentClaims();
  const subject = claims?.sub.toLowerCase();
  return (
    subject !== undefined &&
    (placeholder.identifier === subject ||
      placeholder.identifier.startsWith(`${subject}.`))
  );
}

/**
 * Copies the Telegram identity from a verified OIDC ID token onto the user:
 * the Telegram user id (`id` claim — `sub` is scoped to one bot), the
 * username and, with the `phone` scope, the phone number. The OIDC account
 * row gets the id too, so the identity can be re-checked when accounts are
 * removed.
 *
 * This lets the Login Widget and Mini App flows, which look users up by
 * `telegramId`, find users that signed up with OIDC.
 */
async function syncTelegramIdentity(
  ctx: AuthContext,
  userId: string,
  claims: TelegramOIDCClaims,
  account: TelegramAccount
) {
  if (claims.id === undefined) {
    return;
  }
  await runWithTransaction(ctx.adapter, async () => {
    const telegramId = String(claims.id);
    const username = claims.preferred_username ?? null;

    if (
      account.telegramId !== telegramId ||
      (account.telegramUsername ?? null) !== username
    ) {
      const updated = await ctx.internalAdapter.updateAccount(account.id, {
        telegramId,
        telegramUsername: username,
      } as Partial<Account>);
      if (!updated) {
        throw APIError.from("FORBIDDEN", ERROR_CODES.IDENTITY_UPDATE_REJECTED);
      }
    }

    const user = (await ctx.internalAdapter.findUserById(
      userId
    )) as TelegramUser | null;
    if (!user) {
      return;
    }
    if (user.telegramId && user.telegramId !== telegramId) {
      // The user is linked to a different Telegram account; leave it alone.
      return;
    }
    if (!user.telegramId) {
      const adapter = await getCurrentAdapter(ctx.adapter);
      const owner = await adapter.findOne<TelegramUser>({
        model: "user",
        where: [{ field: "telegramId", value: telegramId }],
      });
      if (owner && owner.id !== userId) {
        ctx.logger.warn(
          "[better-auth-telegram] OIDC: another user already has this Telegram id; not copying it.",
          { userId, otherUserId: owner.id }
        );
        return;
      }
    }

    const update: Partial<TelegramUser> = {};
    if (user.telegramId !== telegramId) {
      update.telegramId = telegramId;
    }
    // `id` is present, so the profile claims are: no `preferred_username`
    // means the Telegram user has no username now.
    if ((user.telegramUsername ?? null) !== username) {
      update.telegramUsername = username;
    }
    if (
      claims.phone_number &&
      user.telegramPhoneNumber !== claims.phone_number
    ) {
      update.telegramPhoneNumber = claims.phone_number;
    }
    if (Object.keys(update).length > 0) {
      const updated = await ctx.internalAdapter.updateUser(userId, update);
      if (!updated) {
        throw APIError.from("FORBIDDEN", ERROR_CODES.IDENTITY_UPDATE_REJECTED);
      }
      await markChanged(userId);
    }
  });
}

/** Stored and mapped values compared as the database would store them. */
function sameValue(stored: unknown, mapped: unknown) {
  if (stored instanceof Date || mapped instanceof Date) {
    return (
      stored !== null &&
      stored !== undefined &&
      mapped !== null &&
      mapped !== undefined &&
      new Date(stored as Date).getTime() === new Date(mapped as Date).getTime()
    );
  }
  if (typeof stored === "object" && typeof mapped === "object") {
    return JSON.stringify(stored) === JSON.stringify(mapped);
  }
  return stored === mapped;
}

/**
 * `oidc.updateUserInfoOnSignIn`: writes the profile from this sign-in
 * (name, image, mapped fields) onto the user, like Better Auth's
 * `overrideUserInfoOnSignIn` but never the email. Runs once Better Auth has
 * allowed the sign-in; a refused update leaves the stored profile, as
 * Better Auth's own profile updates do.
 */
async function updateUserInfo(
  ctx: AuthContext,
  userId: string,
  userInfo: Record<string, unknown>
) {
  const {
    id: _id,
    email: _email,
    emailVerified: _emailVerified,
    name,
    image,
    ...profile
  } = userInfo;
  const user = (await ctx.internalAdapter.findUserById(userId)) as Record<
    string,
    unknown
  > | null;
  if (!user) {
    return;
  }
  try {
    // Field validators can throw here too.
    const changes = Object.fromEntries(
      Object.entries({
        name,
        image,
        ...parseAdditionalUserInputFromProviderProfile(
          ctx.options,
          profile,
          "update"
        ),
      }).filter(
        ([key, value]) => value !== undefined && !sameValue(user[key], value)
      )
    );
    if (Object.keys(changes).length === 0) {
      return;
    }
    if (!(await ctx.internalAdapter.updateUser(userId, changes))) {
      throw new Error("a database hook refused the update");
    }
    await markChanged(userId);
  } catch (error) {
    ctx.logger.warn(
      "[better-auth-telegram] OIDC: could not update the user's profile on sign-in.",
      error
    );
  }
}

/** The user's OIDC account that the verified claims belong to, if any. */
async function accountProvenByClaims(
  ctx: AuthContext,
  userId: string,
  claims: TelegramOIDCClaims
) {
  const accounts = (await ctx.internalAdapter.findAccounts(
    userId
  )) as TelegramAccount[];
  return accounts.find(
    (account) =>
      account.providerId === TELEGRAM_OIDC_PROVIDER_ID &&
      account.accountId === claims.sub
  );
}

/**
 * Keeps `user.telegramId` backed by a linked Telegram account. Called after a
 * Telegram account is removed (by `/telegram/unlink`, Better Auth's
 * `/unlink-account` or anything else): if no remaining account proves the
 * stored Telegram id, it switches to one that does or clears it, so an
 * unlinked Telegram user can no longer sign in through the Login Widget or
 * Mini App lookup by `telegramId`.
 */
export async function reconcileTelegramIdentity(
  ctx: AuthContext,
  userId: string
) {
  const user = (await ctx.internalAdapter.findUserById(
    userId
  )) as TelegramUser | null;
  if (!user?.telegramId) {
    return;
  }
  const accounts = (await ctx.internalAdapter.findAccounts(
    userId
  )) as TelegramAccount[];
  const proving = accounts.filter(
    (account) =>
      TELEGRAM_PROVIDERS.has(account.providerId) && account.telegramId
  );
  if (proving.some((account) => account.telegramId === user.telegramId)) {
    return;
  }
  const [next] = proving;
  const updated = await ctx.internalAdapter.updateUser(userId, {
    telegramId: next?.telegramId ?? null,
    telegramUsername: next?.telegramUsername ?? null,
    telegramPhoneNumber: null,
  });
  if (!updated) {
    throw APIError.from("FORBIDDEN", ERROR_CODES.IDENTITY_UPDATE_REJECTED);
  }
}

/**
 * Database hooks installed by the plugin's `init`:
 * - placeholder emails can only be used by the Telegram flows;
 * - with the Telegram schema fields, the OIDC identity is synced onto the
 *   user, and removing a Telegram account re-checks `user.telegramId`.
 */
type DatabaseHooks = NonNullable<BetterAuthOptions["databaseHooks"]>;

export function telegramIdentityHooks(
  ctx: AuthContext,
  options: { identityFields: boolean; updateUserInfo: boolean }
): DatabaseHooks {
  const placeholderGuard: DatabaseHooks = {
    user: {
      create: {
        async before(user) {
          if (!(await isAllowedPlaceholder(user))) {
            ctx.logger.warn(
              "[better-auth-telegram] Refused to create a user with a Telegram placeholder email outside the Telegram flows."
            );
            return false;
          }
        },
      },
      update: {
        // Same rule as creation, so code that writes an OIDC profile back
        // (Better Auth's `handleOAuthUserInfo` with `selectedUser.profile:
        // "update"`) may keep the user's own placeholder. Thrown rather than
        // vetoed (`false`): a veto lets
        // endpoints such as /change-email report success for a change that
        // never happened.
        async before(data) {
          if (!(await isAllowedPlaceholder(data))) {
            throw APIError.from(
              "BAD_REQUEST",
              ERROR_CODES.PLACEHOLDER_EMAIL_RESERVED
            );
          }
        },
      },
    },
  };

  // Runs once Better Auth has allowed the sign-in (validateUserInfo, account
  // linking rules), before the session is stored.
  const sessionHooks: DatabaseHooks["session"] = {
    create: {
      async before(session) {
        const signIn = await currentSignIn();
        if (!signIn) {
          return;
        }
        // Only the user who owns the OIDC account behind these claims.
        const account = await accountProvenByClaims(
          ctx,
          session.userId,
          signIn.claims
        );
        if (!account) {
          return;
        }
        if (options.identityFields) {
          // A refused identity update stops the sign-in.
          await syncTelegramIdentity(
            ctx,
            session.userId,
            signIn.claims,
            account
          );
        }
        if (options.updateUserInfo) {
          await updateUserInfo(ctx, session.userId, signIn.userInfo);
        }
      },
    },
  };

  if (!options.identityFields) {
    return options.updateUserInfo
      ? { ...placeholderGuard, session: sessionHooks }
      : placeholderGuard;
  }

  return {
    ...placeholderGuard,
    session: sessionHooks,
    account: {
      create: {
        async after(account) {
          if (account.providerId !== TELEGRAM_OIDC_PROVIDER_ID) {
            return;
          }
          const claims = await currentClaims();
          if (claims && account.accountId === claims.sub) {
            await syncTelegramIdentity(ctx, account.userId, claims, account);
          }
        },
      },
      delete: {
        async after(account) {
          if (TELEGRAM_PROVIDERS.has(account.providerId)) {
            await reconcileTelegramIdentity(ctx, account.userId);
          }
        },
      },
    },
  };
}

interface CookieContext {
  context: { responseHeaders?: Headers };
  responseHeaders?: Headers;
}

/** The response headers queued so far, as Better Auth's own cookie helpers see them. */
function pendingHeaders(ctx: CookieContext) {
  return new Set(
    [ctx.responseHeaders, ctx.context.responseHeaders].filter(
      (headers): headers is Headers => headers !== undefined
    )
  );
}

/**
 * Whether the response still sets the session token cookie to `token`; an
 * earlier after hook may have expired it to end the session.
 */
function setsSessionToken(ctx: CookieContext, name: string, token: string) {
  const cookies = [...pendingHeaders(ctx)].flatMap((headers) =>
    headers.getSetCookie()
  );
  const last = cookies.filter((cookie) => cookie.startsWith(`${name}=`)).at(-1);
  if (!last || /;\s*max-age=0(?:;|$)/iu.test(last)) {
    return false;
  }
  const value = last.slice(name.length + 1).split(";")[0] ?? "";
  // A signed cookie: `<token>.<signature>`, URI-encoded.
  return decodeURIComponent(value).startsWith(`${token}.`);
}

/** Drops `Set-Cookie` entries for these cookies (and their chunks) queued so far. */
function dropPendingCookies(ctx: CookieContext, names: string[]) {
  const isNamed = (cookie: string) =>
    names.some(
      (name) => cookie.startsWith(`${name}=`) || cookie.startsWith(`${name}.`)
    );
  for (const headers of pendingHeaders(ctx)) {
    const cookies = headers.getSetCookie();
    if (cookies.some(isNamed)) {
      headers.delete("set-cookie");
      for (const cookie of cookies.filter((entry) => !isNamed(entry))) {
        headers.append("set-cookie", cookie);
      }
    }
  }
}

/**
 * Better Auth issues a session with the user it read before the hooks above
 * ran. When they changed that user, this after hook issues the session
 * cookie (and `newSession`, and the user in an ID token sign-in response)
 * again with the user as stored now, like Better Auth's /update-user;
 * otherwise `session.cookieCache` would serve the old values until it
 * expires, and in stateless mode until the next sign-in.
 */
export const refreshSessionAfterOIDC = {
  matcher: () => true,
  handler: createAuthMiddleware(async (ctx) => {
    const signIn = await currentSignIn();
    const issued = ctx.context.newSession;
    if (!(signIn && issued && signIn.changedUserIds.has(issued.user.id))) {
      return;
    }
    const user = await ctx.context.internalAdapter.findUserById(issued.user.id);
    if (!user) {
      return;
    }
    const { sessionToken, sessionData, dontRememberToken } =
      ctx.context.authCookies;
    if (!setsSessionToken(ctx, sessionToken.name, issued.session.token)) {
      return;
    }
    dropPendingCookies(ctx, [
      sessionToken.name,
      sessionData.name,
      dontRememberToken.name,
    ]);
    await setSessionCookie(ctx, { session: issued.session, user });

    const returned: unknown = ctx.context.returned;
    if (
      returned &&
      typeof returned === "object" &&
      !(returned instanceof Error) &&
      !(returned instanceof Response) &&
      (returned as { user?: { id?: string } }).user?.id === user.id
    ) {
      return ctx.json({
        ...returned,
        user: parseUserOutput(ctx.context.options, user),
      });
    }
  }),
};
