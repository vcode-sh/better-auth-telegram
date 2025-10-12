import type { BetterAuthPlugin, Session, User } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { TelegramAuthData, TelegramPluginOptions } from "./types";
import {
  parseMiniAppInitData,
  validateMiniAppData,
  validateTelegramAuthData,
  verifyMiniAppInitData,
  verifyTelegramAuth,
} from "./verify";

export type {
  TelegramAuthData,
  TelegramMiniAppChat,
  TelegramMiniAppData,
  TelegramMiniAppUser,
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
    maxAuthAge = 86400,
    mapTelegramDataToUser,
    miniApp,
  } = options;

  // Mini Apps configuration
  const miniAppEnabled = miniApp?.enabled ?? false;
  const miniAppValidateInitData = miniApp?.validateInitData ?? true;
  const miniAppAllowAutoSignin = miniApp?.allowAutoSignin ?? true;
  const mapMiniAppDataToUser = miniApp?.mapMiniAppDataToUser;

  if (!botToken) {
    throw new Error("Telegram plugin: botToken is required");
  }

  if (!botUsername) {
    throw new Error("Telegram plugin: botUsername is required");
  }

  return {
    id: "telegram",

    schema: {
      user: {
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
            return ctx.json(
              { error: "Invalid Telegram auth data" },
              { status: 400 }
            );
          }

          const telegramData = body as TelegramAuthData;

          // Verify authentication
          const isValid = verifyTelegramAuth(
            telegramData,
            botToken,
            maxAuthAge
          );

          if (!isValid) {
            return ctx.json(
              { error: "Invalid Telegram authentication" },
              { status: 401 }
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
                value: "telegram",
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
            userId = (existingAccount as any).userId;
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
                providerId: "telegram",
                accountId: telegramData.id.toString(),
                telegramId: telegramData.id.toString(),
                telegramUsername: telegramData.username,
              },
            });
          } else {
            return ctx.json(
              { error: "User not found and auto-create is disabled" },
              { status: 404 }
            );
          }

          // Create session
          const session = await ctx.context.internalAdapter.createSession(
            userId,
            ctx
          );

          const sessionData = await ctx.json({
            user: await ctx.context.adapter.findOne({
              model: "user",
              where: [{ field: "id", value: userId }],
            }),
            session,
          });

          await setSessionCookie(
            ctx,
            sessionData as {
              session: Session;
              user: User;
            }
          );

          return sessionData;
        }
      ),

      linkTelegram: createAuthEndpoint(
        "/telegram/link",
        {
          method: "POST",
        },
        async (ctx) => {
          if (!allowUserToLink) {
            return ctx.json(
              { error: "Linking Telegram accounts is disabled" },
              { status: 403 }
            );
          }

          const body = await ctx.body;
          const session = ctx.context.session;

          if (!session?.user?.id) {
            return ctx.json({ error: "Not authenticated" }, { status: 401 });
          }

          // Validate auth data
          if (!validateTelegramAuthData(body)) {
            return ctx.json(
              { error: "Invalid Telegram auth data" },
              { status: 400 }
            );
          }

          const telegramData = body as TelegramAuthData;

          // Verify authentication
          const isValid = verifyTelegramAuth(
            telegramData,
            botToken,
            maxAuthAge
          );

          if (!isValid) {
            return ctx.json(
              { error: "Invalid Telegram authentication" },
              { status: 401 }
            );
          }

          // Check if Telegram account is already linked to another user
          const existingAccount = await ctx.context.adapter.findOne({
            model: "account",
            where: [
              {
                field: "providerId",
                value: "telegram",
              },
              {
                field: "accountId",
                value: telegramData.id.toString(),
              },
            ],
          });

          if (
            existingAccount &&
            (existingAccount as any).userId !== session.user.id
          ) {
            return ctx.json(
              {
                error:
                  "This Telegram account is already linked to another user",
              },
              { status: 409 }
            );
          }

          if (existingAccount) {
            return ctx.json(
              {
                error:
                  "This Telegram account is already linked to your account",
              },
              { status: 409 }
            );
          }

          // Create account link
          await ctx.context.adapter.create({
            model: "account",
            data: {
              userId: session.user.id,
              providerId: "telegram",
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
            message: "Telegram account linked successfully",
          });
        }
      ),

      unlinkTelegram: createAuthEndpoint(
        "/telegram/unlink",
        {
          method: "POST",
        },
        async (ctx) => {
          const session = ctx.context.session;

          if (!session?.user?.id) {
            return ctx.json({ error: "Not authenticated" }, { status: 401 });
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
                value: "telegram",
              },
            ],
          });

          if (!account) {
            return ctx.json(
              { error: "No Telegram account linked" },
              { status: 404 }
            );
          }

          await ctx.context.adapter.delete({
            model: "account",
            where: [{ field: "id", value: (account as any).id }],
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
            message: "Telegram account unlinked successfully",
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
                  return ctx.json(
                    { error: "initData is required and must be a string" },
                    { status: 400 }
                  );
                }

                // Verify initData
                if (
                  miniAppValidateInitData &&
                  !verifyMiniAppInitData(initData, botToken, maxAuthAge)
                ) {
                  return ctx.json(
                    { error: "Invalid Mini App initData" },
                    { status: 401 }
                  );
                }

                // Parse initData
                const data = parseMiniAppInitData(initData);

                // Validate structure
                if (!validateMiniAppData(data)) {
                  return ctx.json(
                    { error: "Invalid Mini App data structure" },
                    { status: 400 }
                  );
                }

                if (!data.user) {
                  return ctx.json(
                    { error: "No user data in initData" },
                    { status: 400 }
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
                      value: "telegram",
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
                  userId = (existingAccount as any).userId;
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
                      providerId: "telegram",
                      accountId: miniAppUser.id.toString(),
                      telegramId: miniAppUser.id.toString(),
                      telegramUsername: miniAppUser.username,
                    },
                  });
                } else {
                  return ctx.json(
                    {
                      error:
                        "User not found and auto-signin is disabled for Mini Apps",
                    },
                    { status: 404 }
                  );
                }

                // Create session
                const session = await ctx.context.internalAdapter.createSession(
                  userId,
                  ctx
                );

                const sessionData = await ctx.json({
                  user: await ctx.context.adapter.findOne({
                    model: "user",
                    where: [{ field: "id", value: userId }],
                  }),
                  session,
                });

                await setSessionCookie(
                  ctx,
                  sessionData as {
                    session: Session;
                    user: User;
                  }
                );
                return sessionData;
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
                  return ctx.json(
                    { error: "initData is required and must be a string" },
                    { status: 400 }
                  );
                }

                const isValid = verifyMiniAppInitData(
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
  } satisfies BetterAuthPlugin;
};
