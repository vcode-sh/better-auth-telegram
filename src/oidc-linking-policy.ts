import type { GenericEndpointContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import type { Account, User } from "better-auth";
import { APIError } from "better-auth/api";
import { ERROR_CODES, PLUGIN_ID, TELEGRAM_OIDC_PROVIDER_ID } from "./constants";
import type { TelegramOIDCClaims } from "./types";

/** Only a surviving linked account can authorize another Telegram login. */
export async function findProvenTelegramUser(
  ctx: GenericEndpointContext,
  telegramId: string
) {
  const adapter = await getCurrentAdapter(ctx.context.adapter);
  const users = await adapter.findMany<User>({
    model: "user",
    where: [{ field: "telegramId", value: telegramId }],
    limit: 2,
  });
  if (users.length > 1) {
    throw APIError.from("CONFLICT", ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER);
  }
  const [user] = users;
  if (!user) {
    return null;
  }
  const accounts = (await ctx.context.internalAdapter.findAccounts(
    user.id
  )) as (Account & { telegramId?: string | null })[];
  return accounts.some(
    (account) =>
      (account.providerId === PLUGIN_ID && account.accountId === telegramId) ||
      (account.providerId === TELEGRAM_OIDC_PROVIDER_ID &&
        account.telegramId === telegramId)
  )
    ? user
    : null;
}

export async function validateTelegramOIDCLink(
  ctx: GenericEndpointContext,
  user: User,
  claims: TelegramOIDCClaims,
  profile: Record<string, unknown>
) {
  const validate = ctx.context.options.user?.validateUserInfo;
  if (!validate) {
    return;
  }
  // Refuse the link if either policy already rejects it. Better Auth checks
  // sign-in again during continuation, so validation callbacks must be repeatable.
  for (const action of ["link-account", "sign-in"] as const) {
    let result: Awaited<ReturnType<typeof validate>>;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Refuse linking before invoking the next application gate.
      result = await validate(
        {
          user: {
            ...profile,
            id: user.id,
            email:
              typeof profile.email === "string"
                ? profile.email.toLowerCase()
                : undefined,
          },
          source: {
            method: "oauth",
            action,
            oauth: {
              providerId: TELEGRAM_OIDC_PROVIDER_ID,
              profile: { ...claims },
            },
          },
        },
        ctx
      );
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
}
