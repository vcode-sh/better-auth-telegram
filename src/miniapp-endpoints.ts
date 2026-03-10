import type { User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { ERROR_CODES, PLUGIN_ID } from "./constants";
import type { TelegramPluginConfig } from "./plugin-config";
import type { TelegramAccountRecord } from "./types";
import {
  parseMiniAppInitData,
  validateMiniAppData,
  verifyMiniAppInitData,
} from "./verify";

/**
 * Creates the Mini App endpoints: signIn, validate.
 */
export function createMiniAppEndpoints(config: TelegramPluginConfig) {
  return {
    signInWithMiniApp: createAuthEndpoint(
      "/telegram/miniapp/signin",
      {
        method: "POST",
      },
      async (ctx) => {
        const body = await ctx.body;
        const { initData } = body;

        if (!initData || typeof initData !== "string") {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
        }

        // Verify initData
        if (
          config.miniAppValidateInitData &&
          !(await verifyMiniAppInitData(
            initData,
            config.botToken,
            config.maxAuthAge
          ))
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
          throw APIError.from("BAD_REQUEST", ERROR_CODES.NO_USER_IN_INIT_DATA);
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

        const userData = config.mapMiniAppDataToUser
          ? config.mapMiniAppDataToUser(miniAppUser)
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
        } else {
          // Check if a user exists with this telegramId (e.g., created via Login Widget)
          const existingUser = await ctx.context.adapter.findOne({
            model: "user",
            where: [
              {
                field: "telegramId",
                value: miniAppUser.id.toString(),
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
                accountId: miniAppUser.id.toString(),
                telegramId: miniAppUser.id.toString(),
                telegramUsername: miniAppUser.username,
              },
            });
          } else if (config.autoCreateUser && config.miniAppAllowAutoSignin) {
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
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
        }

        const isValid = await verifyMiniAppInitData(
          initData,
          config.botToken,
          config.maxAuthAge
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
