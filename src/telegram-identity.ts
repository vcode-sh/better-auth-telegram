import type { AuthContext, BetterAuthOptions } from "@better-auth/core";
import { APIError } from "better-auth/api";
import { ERROR_CODES, PLUGIN_ID, TELEGRAM_OIDC_PROVIDER_ID } from "./constants";
import { currentSignIn } from "./telegram-identity-state";
import {
  accountProvenByClaims,
  reconcileTelegramIdentity,
  syncTelegramIdentity,
} from "./telegram-identity-sync";
import { isAllowedPlaceholder } from "./telegram-placeholder";
import { updateUserInfo } from "./telegram-profile";

// biome-ignore lint/performance/noBarrelFile: Keep existing internal imports stable across the extraction.
export { refreshSessionAfterOIDC } from "./telegram-identity-session";
export { rememberVerifiedClaims } from "./telegram-identity-state";
export { reconcileTelegramIdentity } from "./telegram-identity-sync";

const TELEGRAM_PROVIDERS = new Set([PLUGIN_ID, TELEGRAM_OIDC_PROVIDER_ID]);

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
        if (account && options.identityFields) {
          // A refused identity update stops the sign-in.
          await syncTelegramIdentity(
            ctx,
            session.userId,
            signIn.claims,
            account
          );
        }
        if (account && options.updateUserInfo) {
          await updateUserInfo(ctx, session.userId, signIn.userInfo);
        }
        // Application validation and profile hooks may await a concurrent unlink.
        if (
          signIn.expectedUserId === session.userId &&
          !(await accountProvenByClaims(ctx, session.userId, signIn.claims))
        ) {
          throw APIError.from("UNAUTHORIZED", ERROR_CODES.ACCOUNT_NOT_LINKED);
        }
      },
    },
  };

  return {
    ...placeholderGuard,
    session: sessionHooks,
    account: {
      create: {
        async before(account) {
          const signIn = await currentSignIn();
          if (
            signIn &&
            account.providerId === TELEGRAM_OIDC_PROVIDER_ID &&
            account.accountId === signIn.claims.sub
          ) {
            // Plugin hooks precede application hooks. Pin the intended owner
            // before an application hook can change the new account binding.
            signIn.expectedUserId ??= account.userId;
          }
        },
        async after(account) {
          if (account.providerId !== TELEGRAM_OIDC_PROVIDER_ID) {
            return;
          }
          const signIn = await currentSignIn();
          if (signIn && account.accountId === signIn.claims.sub) {
            if (signIn.expectedUserId !== account.userId) {
              throw APIError.from(
                "UNAUTHORIZED",
                ERROR_CODES.ACCOUNT_NOT_LINKED
              );
            }
            if (options.identityFields) {
              await syncTelegramIdentity(
                ctx,
                account.userId,
                signIn.claims,
                account
              );
            }
          }
        },
      },
      delete: {
        async after(account) {
          if (
            options.identityFields &&
            TELEGRAM_PROVIDERS.has(account.providerId)
          ) {
            await reconcileTelegramIdentity(ctx, account.userId);
          }
        },
      },
    },
  };
}
