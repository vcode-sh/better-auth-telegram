import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
} from "better-auth/api";
import { ERROR_CODES } from "./constants";
import type { TelegramPluginConfig } from "./plugin-config";
import { findOrCreateTelegramUser, startSession } from "./telegram-account";
import {
  parseMiniAppInitData,
  validateMiniAppData,
  verifyMiniAppInitData,
} from "./verify";

function readInitData(body: unknown): string {
  const initData = (body as { initData?: unknown } | undefined)?.initData;
  if (!initData || typeof initData !== "string") {
    throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
  }
  return initData;
}

function requireBotToken(config: TelegramPluginConfig): string {
  if (!config.botToken) {
    throw APIError.from(
      "INTERNAL_SERVER_ERROR",
      ERROR_CODES.BOT_TOKEN_REQUIRED
    );
  }
  return config.botToken;
}

/**
 * Creates the Mini App endpoints: signIn, validate.
 */
export function createMiniAppEndpoints(config: TelegramPluginConfig) {
  return {
    signInWithMiniApp: createAuthEndpoint(
      "/telegram/miniapp/signin",
      {
        method: "POST",
        // Login CSRF protection, as on /telegram/signin.
        use: [formCsrfMiddleware],
      },
      async (ctx) => {
        const initData = readInitData(ctx.body);

        if (
          config.miniAppValidateInitData &&
          !(await verifyMiniAppInitData(
            initData,
            requireBotToken(config),
            config.maxAuthAge
          ))
        ) {
          throw APIError.from(
            "UNAUTHORIZED",
            ERROR_CODES.INVALID_MINI_APP_INIT_DATA
          );
        }

        const data = parseMiniAppInitData(initData);
        if (!validateMiniAppData(data)) {
          throw APIError.from(
            "BAD_REQUEST",
            ERROR_CODES.INVALID_MINI_APP_DATA_STRUCTURE
          );
        }
        if (!data.user) {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.NO_USER_IN_INIT_DATA);
        }

        const miniAppUser = data.user;
        const user = await findOrCreateTelegramUser(ctx, {
          identity: {
            telegramId: String(miniAppUser.id),
            username: miniAppUser.username,
          },
          userData: {
            name: miniAppUser.last_name
              ? `${miniAppUser.first_name} ${miniAppUser.last_name}`
              : miniAppUser.first_name,
            image: miniAppUser.photo_url,
            ...config.mapMiniAppDataToUser?.(miniAppUser),
          },
          allowCreate: config.autoCreateUser && config.miniAppAllowAutoSignin,
          method: "telegram-mini-app",
          notFound: ERROR_CODES.MINI_APP_AUTO_SIGNIN_DISABLED,
        });

        return startSession(ctx, user);
      }
    ),

    validateMiniApp: createAuthEndpoint(
      "/telegram/miniapp/validate",
      {
        method: "POST",
      },
      async (ctx) => {
        const initData = readInitData(ctx.body);
        const botToken = requireBotToken(config);

        if (
          !(await verifyMiniAppInitData(initData, botToken, config.maxAuthAge))
        ) {
          return ctx.json({
            valid: false,
            data: null,
          });
        }

        return ctx.json({
          valid: true,
          data: parseMiniAppInitData(initData),
        });
      }
    ),
  };
}

/**
 * Rate limit rules for Mini App endpoints.
 */
export function getMiniAppRateLimits() {
  return [
    {
      pathMatcher: (path: string) => path === "/telegram/miniapp/signin",
      window: 60,
      max: 10,
    },
    {
      pathMatcher: (path: string) => path === "/telegram/miniapp/validate",
      window: 60,
      max: 20,
    },
  ];
}
