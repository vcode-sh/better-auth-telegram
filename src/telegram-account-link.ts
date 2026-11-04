import type { GenericEndpointContext } from "@better-auth/core";
import { runWithTransaction } from "@better-auth/core/context";
import { APIError } from "better-auth/api";
import { ERROR_CODES, PLUGIN_ID } from "./constants";
import {
  accountData,
  assertValidUserInfo,
  findTelegramAccount,
  findUserByTelegramId,
  type TelegramIdentity,
  type TelegramUser,
  withTelegramOperation,
} from "./telegram-account-state";
import { reconcileTelegramIdentity } from "./telegram-identity-sync";

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
  await withTelegramOperation(ctx, `telegram:${identity.telegramId}`, () =>
    withTelegramOperation(ctx, `user:${user.id}`, () =>
      link(ctx, user, identity)
    )
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
  return await withTelegramOperation(ctx, `user:${userId}`, () =>
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
