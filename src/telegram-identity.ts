import type { AuthContext, BetterAuthOptions } from "@better-auth/core";
import { defineRequestState, hasRequestState } from "@better-auth/core/context";
import type { Account, User } from "better-auth";
import {
  PLACEHOLDER_EMAIL_DOMAINS,
  PLUGIN_ID,
  TELEGRAM_OIDC_PROVIDER_ID,
} from "./constants";
import type { TelegramOIDCClaims } from "./types";

/**
 * Claims of the Telegram ID token verified during the current request.
 * Set by the OIDC provider's `getUserInfo`, read by the database hooks below.
 */
const verifiedClaims = defineRequestState<TelegramOIDCClaims | null>(
  () => null
);

export async function rememberVerifiedClaims(claims: TelegramOIDCClaims) {
  if (await hasRequestState()) {
    await verifiedClaims.set(claims);
  }
}

async function currentClaims() {
  return (await hasRequestState()) ? await verifiedClaims.get() : null;
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
    return placeholder.identifier === String(user.telegramId ?? "");
  }
  const claims = await currentClaims();
  return claims !== null && placeholder.identifier === claims.sub.toLowerCase();
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
  const telegramId = String(claims.id);
  const username = claims.preferred_username ?? null;

  if (
    account.telegramId !== telegramId ||
    (account.telegramUsername ?? null) !== username
  ) {
    await ctx.internalAdapter.updateAccount(account.id, {
      telegramId,
      telegramUsername: username,
    } as Partial<Account>);
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
    const owner = await ctx.adapter.findOne<TelegramUser>({
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
  if (username && user.telegramUsername !== username) {
    update.telegramUsername = username;
  }
  if (claims.phone_number && user.telegramPhoneNumber !== claims.phone_number) {
    update.telegramPhoneNumber = claims.phone_number;
  }
  if (Object.keys(update).length > 0) {
    await ctx.internalAdapter.updateUser(userId, update);
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
  await ctx.internalAdapter.updateUser(userId, {
    telegramId: next?.telegramId ?? null,
    telegramUsername: next?.telegramUsername ?? null,
    telegramPhoneNumber: null,
  });
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
  { identityFields }: { identityFields: boolean }
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
        before(data) {
          if (placeholderIdentifier(data.email)) {
            ctx.logger.warn(
              "[better-auth-telegram] Refused to change a user's email to a Telegram placeholder."
            );
            return Promise.resolve(false);
          }
          return Promise.resolve();
        },
      },
    },
  };

  if (!identityFields) {
    return placeholderGuard;
  }

  return {
    ...placeholderGuard,
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
    session: {
      create: {
        async after(session) {
          const claims = await currentClaims();
          if (!claims) {
            return;
          }
          // Only the user who owns the OIDC account behind these claims.
          const account = await accountProvenByClaims(
            ctx,
            session.userId,
            claims
          );
          if (account) {
            await syncTelegramIdentity(ctx, session.userId, claims, account);
          }
        },
      },
    },
  };
}
