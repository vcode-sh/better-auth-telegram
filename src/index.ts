import type { BetterAuthPlugin, User } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
  DEFAULT_MAX_AUTH_AGE,
  ERROR_CODES,
  PLUGIN_ID,
  SUCCESS_MESSAGES,
} from "./constants";
import { createTelegramOIDCProvider } from "./oidc";
import type {
  TelegramAccountRecord,
  TelegramAuthData,
  TelegramPluginOptions,
} from "./types";
import {
  parseMiniAppInitData,
  validateMiniAppData,
  validateTelegramAuthData,
  verifyMiniAppInitData,
  verifyTelegramAuth,
} from "./verify";

// biome-ignore lint/performance/noBarrelFile: Public API re-export
export { createTelegramOIDCProvider } from "./oidc";
export type {
  TelegramAccountRecord,
  TelegramAuthData,
  TelegramMiniAppChat,
  TelegramMiniAppData,
  TelegramMiniAppUser,
  TelegramOIDCClaims,
  TelegramOIDCOptions,
  TelegramPluginOptions,
} from "./types";

/**
 * Telegram authentication plugin for Better Auth
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { telegram } from "better-auth-telegram";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     telegram({
 *       botToken: process.env.TELEGRAM_BOT_TOKEN!,
 *       botUsername: "your_bot_username"
 *     })
 *   ]
 * });
 * ```
 */
export const telegram = (options: TelegramPluginOptions) => {
  const {
    botToken,
    botUsername,
    allowUserToLink = true,
    autoCreateUser = true,
    maxAuthAge = DEFAULT_MAX_AUTH_AGE,
    mapTelegramDataToUser,
    miniApp,
    oidc,
  } = options;

  // Mini Apps configuration
  const miniAppEnabled = miniApp?.enabled ?? false;

  // OIDC configuration
  const oidcEnabled = oidc?.enabled ?? false;
  const miniAppValidateInitData = miniApp?.validateInitData ?? true;
  const miniAppAllowAutoSignin = miniApp?.allowAutoSignin ?? true;
  const mapMiniAppDataToUser = miniApp?.mapMiniAppDataToUser;

  if (!botToken) {
    throw new Error(ERROR_CODES.BOT_TOKEN_REQUIRED.message);
  }

  if (!botUsername) {
    throw new Error(ERROR_CODES.BOT_USERNAME_REQUIRED.message);
  }

  return {
    id: PLUGIN_ID,

    // Inject OIDC provider into better-auth's social providers
    ...(oidcEnabled
      ? {
          init: (ctx) => ({
            context: {
              socialProviders: [
                createTelegramOIDCProvider(botToken, oidc!),
                ...ctx.socialProviders,
              ],
            },
          }),
        }
      : {}),

    schema: {
      user: {
        fields: {
          telegramId: {
            type: "string",
            required: false,
            unique: false,
            input: false,
          },
          telegramPhoneNumber: {
            type: "string",
            required: false,
            unique: false,
            input: false,
          },
          telegramUsername: {
            type: "string",
            required: false,
            unique: false,
            input: false,
          },
        },
      },
      account: {
        fields: {
          telegramId: {
            type: "string",
            required: false,
            unique: false,
          },
          telegramUsername: {
            type: "string",
            required: false,
            unique: false,
          },
        },
      },
    },

    endpoints: {
      signInWithTelegram: createAuthEndpoint(
        "/telegram/signin",
        {
          method: "POST",
        },
        async (ctx) => {
          const body = await ctx.body;

          // Validate auth data structure
          if (!validateTelegramAuthData(body)) {
            throw APIError.from("BAD_REQUEST", ERROR_CODES.INVALID_AUTH_DATA);
          }

          const telegramData = body as TelegramAuthData;

          // Verify authentication
          const isValid = await verifyTelegramAuth(
            telegramData,
            botToken,
            maxAuthAge
          );

          if (!isValid) {
            throw APIError.from(
              "UNAUTHORIZED",
              ERROR_CODES.INVALID_AUTHENTICATION
            );
          }

          // Map Telegram data to user
          const defaultUserData = {
            name: telegramData.last_name
              ? `${telegramData.first_name} ${telegramData.last_name}`
              : telegramData.first_name,
            image: telegramData.photo_url,
            email: undefined, // Telegram doesn't provide email
          };

          const userData = mapTelegramDataToUser
            ? mapTelegramDataToUser(telegramData)
            : defaultUserData;

          // Find existing account by telegramId
          const existingAccount = await ctx.context.adapter.findOne({
            model: "account",
            where: [
              {
                field: "providerId",
                value: PLUGIN_ID,
              },
              {
                field: "accountId",
                value: telegramData.id.toString(),
              },
            ],
          });

          let userId: string;

          if (existingAccount) {
            // User already has Telegram linked
            userId = (existingAccount as TelegramAccountRecord).userId;
          } else if (autoCreateUser) {
            // Create new user
            const newUser = await ctx.context.adapter.create({
              model: "user",
              data: {
                ...userData,
                telegramId: telegramData.id.toString(),
                telegramUsername: telegramData.username,
              },
            });

            userId = newUser.id;

            // Create account
            await ctx.context.adapter.create({
              model: "account",
              data: {
                userId: newUser.id,
                providerId: PLUGIN_ID,
                accountId: telegramData.id.toString(),
                telegramId: telegramData.id.toString(),
                telegramUsername: telegramData.username,
              },
            });
          } else {
            throw APIError.from(
              "NOT_FOUND",
              ERROR_CODES.USER_CREATION_DISABLED
            );
          }

          // Create session
          const session =
            await ctx.context.internalAdapter.createSession(userId);

          const user = await ctx.context.adapter.findOne({
            model: "user",
            where: [{ field: "id", value: userId }],
          });

          await setSessionCookie(ctx, {
            session,
            user: user as User,
          });

          return ctx.json({
            user,
            session,
          });
        }
      ),

      linkTelegram: createAuthEndpoint(
        "/telegram/link",
        {
          method: "POST",
          use: [sessionMiddleware],
        },
        async (ctx) => {
          if (!allowUserToLink) {
            throw APIError.from("FORBIDDEN", ERROR_CODES.LINKING_DISABLED);
          }

          const body = await ctx.body;
          const session = ctx.context.session;

          if (!session?.user?.id) {
            throw APIError.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
          }

          // Validate auth data
          if (!validateTelegramAuthData(body)) {
            throw APIError.from("BAD_REQUEST", ERROR_CODES.INVALID_AUTH_DATA);
          }

          const telegramData = body as TelegramAuthData;

          // Verify authentication
          const isValid = await verifyTelegramAuth(
            telegramData,
            botToken,
            maxAuthAge
          );

          if (!isValid) {
            throw APIError.from(
              "UNAUTHORIZED",
              ERROR_CODES.INVALID_AUTHENTICATION
            );
          }

          // Check if Telegram account is already linked to another user
          const existingAccount = await ctx.context.adapter.findOne({
            model: "account",
            where: [
              {
                field: "providerId",
                value: PLUGIN_ID,
              },
              {
                field: "accountId",
                value: telegramData.id.toString(),
              },
            ],
          });

          if (
            existingAccount &&
            (existingAccount as TelegramAccountRecord).userId !==
              session.user.id
          ) {
            throw APIError.from(
              "CONFLICT",
              ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER
            );
          }

          if (existingAccount) {
            throw APIError.from(
              "CONFLICT",
              ERROR_CODES.TELEGRAM_ALREADY_LINKED_SELF
            );
          }

          // Create account link
          await ctx.context.adapter.create({
            model: "account",
            data: {
              userId: session.user.id,
              providerId: PLUGIN_ID,
              accountId: telegramData.id.toString(),
              telegramId: telegramData.id.toString(),
              telegramUsername: telegramData.username,
            },
          });

          // Update user with Telegram data
          await ctx.context.adapter.update({
            model: "user",
            where: [{ field: "id", value: session.user.id }],
            update: {
              telegramId: telegramData.id.toString(),
              telegramUsername: telegramData.username,
            },
          });

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
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const session = ctx.context.session;

          if (!session?.user?.id) {
            throw APIError.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
          }

          // Find and delete Telegram account
          const account = await ctx.context.adapter.findOne({
            model: "account",
            where: [
              {
                field: "userId",
                value: session.user.id,
              },
              {
                field: "providerId",
                value: PLUGIN_ID,
              },
            ],
          });

          if (!account) {
            throw APIError.from("NOT_FOUND", ERROR_CODES.NOT_LINKED);
          }

          await ctx.context.adapter.delete({
            model: "account",
            where: [
              {
                field: "id",
                value: (account as TelegramAccountRecord).id,
              },
            ],
          });

          // Clear Telegram data from user
          await ctx.context.adapter.update({
            model: "user",
            where: [{ field: "id", value: session.user.id }],
            update: {
              telegramId: null,
              telegramUsername: null,
            },
          });

          return ctx.json({
            success: true,
            message: SUCCESS_MESSAGES.TELEGRAM_UNLINKED,
          });
        }
      ),

      getTelegramConfig: createAuthEndpoint(
        "/telegram/config",
        {
          method: "GET",
        },
        async (ctx) =>
          ctx.json({
            botUsername,
            miniAppEnabled,
            oidcEnabled,
          })
      ),

      // Mini Apps endpoints (only available when enabled)
      ...(miniAppEnabled
        ? {
            signInWithMiniApp: createAuthEndpoint(
              "/telegram/miniapp/signin",
              {
                method: "POST",
              },
              async (ctx) => {
                const body = await ctx.body;
                const { initData } = body;

                if (!initData || typeof initData !== "string") {
                  throw APIError.from(
                    "BAD_REQUEST",
                    ERROR_CODES.INIT_DATA_REQUIRED
                  );
                }

                // Verify initData
                if (
                  miniAppValidateInitData &&
                  !(await verifyMiniAppInitData(initData, botToken, maxAuthAge))
                ) {
                  throw APIError.from(
                    "UNAUTHORIZED",
                    ERROR_CODES.INVALID_MINI_APP_INIT_DATA
                  );
                }

                // Parse initData
                const data = parseMiniAppInitData(initData);

                // Validate structure
                if (!validateMiniAppData(data)) {
                  throw APIError.from(
                    "BAD_REQUEST",
                    ERROR_CODES.INVALID_MINI_APP_DATA_STRUCTURE
                  );
                }

                if (!data.user) {
                  throw APIError.from(
                    "BAD_REQUEST",
                    ERROR_CODES.NO_USER_IN_INIT_DATA
                  );
                }

                const miniAppUser = data.user;

                // Map Mini App user data to user object
                const defaultUserData = {
                  name: miniAppUser.last_name
                    ? `${miniAppUser.first_name} ${miniAppUser.last_name}`
                    : miniAppUser.first_name,
                  image: miniAppUser.photo_url,
                  email: undefined, // Telegram doesn't provide email
                };

                const userData = mapMiniAppDataToUser
                  ? mapMiniAppDataToUser(miniAppUser)
                  : defaultUserData;

                // Find existing account by telegramId
                const existingAccount = await ctx.context.adapter.findOne({
                  model: "account",
                  where: [
                    {
                      field: "providerId",
                      value: PLUGIN_ID,
                    },
                    {
                      field: "accountId",
                      value: miniAppUser.id.toString(),
                    },
                  ],
                });

                let userId: string;

                if (existingAccount) {
                  // User already has Telegram linked
                  userId = (existingAccount as TelegramAccountRecord).userId;
                } else if (autoCreateUser && miniAppAllowAutoSignin) {
                  // Create new user
                  const newUser = await ctx.context.adapter.create({
                    model: "user",
                    data: {
                      ...userData,
                      telegramId: miniAppUser.id.toString(),
                      telegramUsername: miniAppUser.username,
                    },
                  });

                  userId = newUser.id;

                  // Create account
                  await ctx.context.adapter.create({
                    model: "account",
                    data: {
                      userId: newUser.id,
                      providerId: PLUGIN_ID,
                      accountId: miniAppUser.id.toString(),
                      telegramId: miniAppUser.id.toString(),
                      telegramUsername: miniAppUser.username,
                    },
                  });
                } else {
                  throw APIError.from(
                    "NOT_FOUND",
                    ERROR_CODES.MINI_APP_AUTO_SIGNIN_DISABLED
                  );
                }

                // Create session
                const session =
                  await ctx.context.internalAdapter.createSession(userId);

                const user = await ctx.context.adapter.findOne({
                  model: "user",
                  where: [{ field: "id", value: userId }],
                });

                await setSessionCookie(ctx, {
                  session,
                  user: user as User,
                });

                return ctx.json({
                  session,
                  user,
                });
              }
            ),

            validateMiniApp: createAuthEndpoint(
              "/telegram/miniapp/validate",
              {
                method: "POST",
              },
              async (ctx) => {
                const body = await ctx.body;
                const { initData } = body;

                if (!initData || typeof initData !== "string") {
                  throw APIError.from(
                    "BAD_REQUEST",
                    ERROR_CODES.INIT_DATA_REQUIRED
                  );
                }

                const isValid = await verifyMiniAppInitData(
                  initData,
                  botToken,
                  maxAuthAge
                );

                if (!isValid) {
                  return ctx.json({
                    valid: false,
                    data: null,
                  });
                }

                const data = parseMiniAppInitData(initData);

                return ctx.json({
                  valid: true,
                  data,
                });
              }
            ),
          }
        : {}),
    },

    $ERROR_CODES: ERROR_CODES,

    rateLimit: [
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
    ],
  } satisfies BetterAuthPlugin;
};
