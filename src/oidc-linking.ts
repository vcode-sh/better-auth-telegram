import type { GenericEndpointContext } from "@better-auth/core";
import {
  getCurrentAdapter,
  runWithTransaction,
  tryGetCurrentAuthEndpointContext,
} from "@better-auth/core/context";
import type { OAuth2Tokens, OAuthProvider } from "@better-auth/core/oauth2";
import type { Account } from "better-auth";
import { APIError, getOAuthState } from "better-auth/api";
import { applyUpdateUserInfoOnLink, setTokenUtil } from "better-auth/oauth2";
import { ERROR_CODES, TELEGRAM_OIDC_PROVIDER_ID } from "./constants";
import {
  findProvenTelegramUser,
  validateTelegramOIDCLink,
} from "./oidc-linking-policy";
import { withTelegramOperation } from "./telegram-account";
import type { TelegramOIDCClaims } from "./types";

async function linkVerifiedIdentity(
  ctx: GenericEndpointContext,
  claims: TelegramOIDCClaims,
  profile: Record<string, unknown>,
  tokens: OAuth2Tokens
) {
  const telegramId = claims.id;
  if (!telegramId) {
    return;
  }
  const key = { providerId: TELEGRAM_OIDC_PROVIDER_ID, accountId: claims.sub };
  await withTelegramOperation(ctx, `oidc:${claims.sub}`, async () => {
    const hasBinding = async () =>
      (await getCurrentAdapter(ctx.context.adapter)).findOne<Account>({
        model: "account",
        where: [
          { field: "providerId", value: key.providerId },
          { field: "accountId", value: key.accountId },
        ],
      });
    if (await hasBinding()) {
      return;
    }
    const user = await findProvenTelegramUser(ctx, telegramId);
    if (!user) {
      return;
    }
    const linking = ctx.context.options.account?.accountLinking;
    if (
      linking?.enabled === false ||
      linking?.disableImplicitLinking === true
    ) {
      throw APIError.from("UNAUTHORIZED", ERROR_CODES.ACCOUNT_NOT_LINKED);
    }
    await withTelegramOperation(ctx, `user:${user.id}`, async () => {
      await validateTelegramOIDCLink(ctx, user, claims, profile);
      // Guard the final account write after all application hooks, before any
      // adapter persists it. A hook cannot redirect this authentication binding.
      const guarded: typeof ctx.context.adapter = {
        ...ctx.context.adapter,
        transaction: (task) =>
          ctx.context.adapter.transaction((adapter) =>
            task({
              ...adapter,
              create: async (data) => {
                if (
                  data.model === "account" &&
                  (data.data.providerId !== key.providerId ||
                    data.data.accountId !== key.accountId ||
                    data.data.userId !== user.id)
                ) {
                  throw APIError.from(
                    "CONFLICT",
                    ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER
                  );
                }
                if (
                  data.model === "account" &&
                  (await findProvenTelegramUser(ctx, telegramId))?.id !==
                    user.id
                ) {
                  throw APIError.from(
                    "UNAUTHORIZED",
                    ERROR_CODES.ACCOUNT_NOT_LINKED
                  );
                }
                return adapter.create(data);
              },
            })
          ),
      };
      await runWithTransaction(guarded, async () => {
        if (await hasBinding()) {
          return;
        }
        if ((await findProvenTelegramUser(ctx, telegramId))?.id !== user.id) {
          throw APIError.from("UNAUTHORIZED", ERROR_CODES.ACCOUNT_NOT_LINKED);
        }
        const linked = await ctx.context.internalAdapter.linkAccount({
          ...key,
          userId: user.id,
          accessToken: await setTokenUtil(tokens.accessToken, ctx.context),
          refreshToken: await setTokenUtil(tokens.refreshToken, ctx.context),
          idToken: tokens.idToken,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          scope: tokens.scopes?.join(","),
        });
        if (!linked) {
          throw APIError.from(
            "FORBIDDEN",
            ERROR_CODES.ACCOUNT_CREATION_REJECTED
          );
        }
        if (
          linked.userId !== user.id ||
          linked.accountId !== key.accountId ||
          linked.providerId !== key.providerId
        ) {
          throw APIError.from(
            "CONFLICT",
            ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER
          );
        }
        await applyUpdateUserInfoOnLink(
          ctx,
          user.id,
          profile as Parameters<typeof applyUpdateUserInfoOnLink>[2]
        );
      });
    });
  });
}

/**
 * Complete cross-flow identity matching after token verification and mapping,
 * before Better Auth's ordinary account lookup. Existing OIDC bindings win;
 * explicit linkSocial and account-info requests retain their native behavior.
 */
export function withTelegramIdentityLinking(
  provider: OAuthProvider<TelegramOIDCClaims>
): OAuthProvider<TelegramOIDCClaims> {
  return {
    ...provider,
    async getUserInfo(tokens) {
      const result = await provider.getUserInfo(tokens);
      const current = tryGetCurrentAuthEndpointContext();
      if (!(result && current)) {
        return result;
      }
      const isCallback =
        current.path === "/callback/:id" &&
        current.params?.id === TELEGRAM_OIDC_PROVIDER_ID;
      const isTokenSignIn =
        current.path === "/sign-in/social" &&
        current.body?.provider === TELEGRAM_OIDC_PROVIDER_ID &&
        !!current.body?.idToken;
      if ((isCallback && !(await getOAuthState())?.link) || isTokenSignIn) {
        await linkVerifiedIdentity(
          current as GenericEndpointContext,
          result.data,
          result.user,
          tokens
        );
      }
      return result;
    },
  };
}
