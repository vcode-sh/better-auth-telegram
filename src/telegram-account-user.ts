import type { GenericEndpointContext } from "@better-auth/core";
import { runWithTransaction } from "@better-auth/core/context";
import type { Account } from "better-auth";
import { APIError } from "better-auth/api";
import { parseAdditionalUserInputFromProviderProfile } from "better-auth/db";
import { ERROR_CODES } from "./constants";
import {
  accountData,
  assertValidUserInfo,
  findTelegramAccount,
  type TelegramAccount,
  type TelegramIdentity,
  type TelegramProvisioningMethod,
  type TelegramProvisioningOptions,
  type TelegramUser,
} from "./telegram-account-state";

/** Application hooks may revoke or move the account while a sign-in is awaiting them. */
async function requireAccountOwner(
  ctx: GenericEndpointContext,
  userId: string,
  telegramId: string
) {
  const account = await findTelegramAccount(ctx, telegramId);
  if (!account || account.userId !== userId) {
    throw APIError.from("UNAUTHORIZED", ERROR_CODES.ACCOUNT_NOT_LINKED);
  }
  return account;
}

/** Keeps the stored Telegram username current (it can change at any time). */
export async function refreshIdentity(
  ctx: GenericEndpointContext,
  user: TelegramUser,
  account: TelegramAccount,
  identity: TelegramIdentity
): Promise<TelegramUser> {
  // SQL adapters return null for a missing username, the identity has undefined.
  const username = identity.username ?? null;
  const accountChanged = (account.telegramUsername ?? null) !== username;
  if (accountChanged) {
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
    if (accountChanged) {
      await requireAccountOwner(ctx, user.id, identity.telegramId);
    }
    return user;
  }
  const updated =
    ((await ctx.context.internalAdapter.updateUser(
      user.id,
      userUpdate
    )) as TelegramUser | null) ?? user;
  await requireAccountOwner(ctx, user.id, identity.telegramId);
  return updated;
}

/** Signs a returning Telegram user in through their `telegram` account. */
export async function signInWithAccount(
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
  // The application gate may await work while an account is revoked. Its old
  // lookup is no longer authority to create a new authenticated session.
  const currentAccount = await requireAccountOwner(
    ctx,
    user.id,
    identity.telegramId
  );
  return await refreshIdentity(ctx, user, currentAccount, identity);
}

/**
 * Creates the user and their `telegram` account, in a transaction. Mapper
 * output goes through Better Auth's provider-profile parsing, as OAuth
 * sign-ups do: no `id`, no `emailVerified` (nothing verified the mapper's
 * email), no `input: false` or unknown fields.
 */
export async function createTelegramUser(
  ctx: GenericEndpointContext,
  options: TelegramProvisioningOptions,
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
