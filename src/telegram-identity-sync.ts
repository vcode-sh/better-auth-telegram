import type { AuthContext } from "@better-auth/core";
import {
  getCurrentAdapter,
  runWithTransaction,
} from "@better-auth/core/context";
import type { Account } from "better-auth";
import { APIError } from "better-auth/api";
import { ERROR_CODES, PLUGIN_ID, TELEGRAM_OIDC_PROVIDER_ID } from "./constants";
import type { TelegramAccount, TelegramUser } from "./telegram-account-state";
import { markChanged } from "./telegram-identity-state";
import type { TelegramOIDCClaims } from "./types";

const TELEGRAM_PROVIDERS = new Set([PLUGIN_ID, TELEGRAM_OIDC_PROVIDER_ID]);

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
export async function syncTelegramIdentity(
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

/** The user's OIDC account that the verified claims belong to, if any. */
export async function accountProvenByClaims(
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
