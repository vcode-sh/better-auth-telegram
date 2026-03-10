import type { User } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { ERROR_CODES, PLUGIN_ID, SUCCESS_MESSAGES } from "./constants";
import type { TelegramPluginConfig } from "./plugin-config";
import type { TelegramAccountRecord, TelegramAuthData } from "./types";
import { validateTelegramAuthData, verifyTelegramAuth } from "./verify";

/**
 * Creates the Login Widget endpoints: signIn, link, unlink.
 */
export function createWidgetEndpoints(config: TelegramPluginConfig) {
  return {
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
          config.botToken,
          config.maxAuthAge
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

        const userData = config.mapTelegramDataToUser
          ? config.mapTelegramDataToUser(telegramData)
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
        } else {
          // Check if a user exists with this telegramId (e.g., created via Mini App)
          const existingUser = await ctx.context.adapter.findOne({
            model: "user",
            where: [
              {
                field: "telegramId",
                value: telegramData.id.toString(),
              },
            ],
          });

          if (existingUser) {
            // User exists from another provider — link telegram account to them
            userId = (existingUser as User).id;

            await ctx.context.adapter.create({
              model: "account",
              data: {
                userId,
                providerId: PLUGIN_ID,
                accountId: telegramData.id.toString(),
                telegramId: telegramData.id.toString(),
                telegramUsername: telegramData.username,
              },
            });
          } else if (config.autoCreateUser) {
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
        }

        // Create session
        const session = await ctx.context.internalAdapter.createSession(userId);

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
        if (!config.allowUserToLink) {
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
          config.botToken,
          config.maxAuthAge
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
          (existingAccount as TelegramAccountRecord).userId !== session.user.id
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
