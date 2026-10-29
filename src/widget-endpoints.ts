import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
  freshSessionMiddleware,
  sessionMiddleware,
} from "better-auth/api";
import { ERROR_CODES, SUCCESS_MESSAGES } from "./constants";
import type { TelegramPluginConfig } from "./plugin-config";
import {
  findOrCreateTelegramUser,
  linkTelegramAccount,
  refreshSessionCookie,
  startSession,
  type TelegramIdentity,
  unlinkTelegramAccount,
} from "./telegram-account";
import type { TelegramAuthData } from "./types";
import { validateTelegramAuthData, verifyTelegramAuth } from "./verify";

/**
 * Validates and verifies a Login Widget payload, returning the proven
 * Telegram identity. Throws 400 for malformed data and 401 for data that
 * Telegram did not sign (or that is too old).
 */
async function verifiedWidgetData(
  config: TelegramPluginConfig,
  body: unknown
): Promise<{ data: TelegramAuthData; identity: TelegramIdentity }> {
  if (!config.botToken) {
    throw APIError.from(
      "INTERNAL_SERVER_ERROR",
      ERROR_CODES.BOT_TOKEN_REQUIRED
    );
  }
  if (!validateTelegramAuthData(body)) {
    throw APIError.from("BAD_REQUEST", ERROR_CODES.INVALID_AUTH_DATA);
  }
  if (!(await verifyTelegramAuth(body, config.botToken, config.maxAuthAge))) {
    throw APIError.from("UNAUTHORIZED", ERROR_CODES.INVALID_AUTHENTICATION);
  }
  return {
    data: body,
    identity: { telegramId: String(body.id), username: body.username },
  };
}

/**
 * Creates the Login Widget endpoints: signIn, link, unlink.
 */
export function createWidgetEndpoints(config: TelegramPluginConfig) {
  return {
    signInWithTelegram: createAuthEndpoint(
      "/telegram/signin",
      {
        method: "POST",
        // Like Better Auth's /sign-in/email: a browser request from an
        // untrusted origin is refused even without cookies (login CSRF).
        use: [formCsrfMiddleware],
      },
      async (ctx) => {
        const { data, identity } = await verifiedWidgetData(config, ctx.body);

        const user = await findOrCreateTelegramUser(ctx, {
          identity,
          userData: {
            name: data.last_name
              ? `${data.first_name} ${data.last_name}`
              : data.first_name,
            image: data.photo_url,
            ...config.mapTelegramDataToUser?.(data),
          },
          allowCreate: config.autoCreateUser,
          method: "telegram-login-widget",
          notFound: ERROR_CODES.USER_CREATION_DISABLED,
        });

        return startSession(ctx, user);
      }
    ),

    linkTelegram: createAuthEndpoint(
      "/telegram/link",
      {
        method: "POST",
        use: [sessionMiddleware],
      },
      async (ctx) => {
        if (
          !config.allowUserToLink ||
          ctx.context.options.account?.accountLinking?.enabled === false
        ) {
          throw APIError.from("FORBIDDEN", ERROR_CODES.LINKING_DISABLED);
        }

        const { identity } = await verifiedWidgetData(config, ctx.body);
        await linkTelegramAccount(ctx, ctx.context.session.user, identity);
        await refreshSessionCookie(ctx, ctx.context.session);

        return ctx.json({
          success: true,
          message: SUCCESS_MESSAGES.TELEGRAM_LINKED,
        });
      }
    ),

    unlinkTelegram: createAuthEndpoint(
      "/telegram/unlink",
      {
        method: "POST",
        // Same as Better Auth's /unlink-account: a recent sign-in.
        use: [freshSessionMiddleware],
      },
      async (ctx) => {
        await unlinkTelegramAccount(ctx, ctx.context.session.user.id);
        await refreshSessionCookie(ctx, ctx.context.session);

        return ctx.json({
          success: true,
          message: SUCCESS_MESSAGES.TELEGRAM_UNLINKED,
        });
      }
    ),
  };
}

/**
 * Rate limit rules for Login Widget endpoints.
 */
export function getWidgetRateLimits() {
  return [
    {
      pathMatcher: (path: string) => path === "/telegram/signin",
      window: 60,
      max: 10,
    },
    {
      pathMatcher: (path: string) => path === "/telegram/link",
      window: 60,
      max: 5,
    },
    {
      pathMatcher: (path: string) => path === "/telegram/unlink",
      window: 60,
      max: 5,
    },
  ];
}
