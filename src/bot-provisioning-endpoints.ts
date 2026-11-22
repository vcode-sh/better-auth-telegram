import { APIError, createAuthEndpoint } from "better-auth/api";
import { ERROR_CODES } from "./constants";
import type { TelegramPluginConfig } from "./plugin-config";
import { findOrCreateTelegramUser } from "./telegram-account";

/**
 * Creates the optional pathless server-only provisioning operation. The host
 * verifies the Telegram update and authenticates the caller; this operation
 * only creates or resolves the local user for an already proven Telegram ID.
 */
export function createBotProvisioningEndpoints(config: TelegramPluginConfig) {
  return {
    provisionTelegramUser: createAuthEndpoint(
      {
        method: "POST",
        metadata: {
          SERVER_ONLY: true,
          $Infer: {
            body: {} as {
              telegramId: number;
              username?: string;
              firstName: string;
              lastName?: string;
            },
          },
        },
      },
      async (ctx) => {
        // This pathless endpoint is called only after the host has
        // authenticated the bot service and verified the update's sender.
        if (ctx.request) {
          throw APIError.from(
            "FORBIDDEN",
            ERROR_CODES.BOT_PROVISIONING_SERVER_ONLY
          );
        }
        const body: unknown = ctx.body;
        if (
          typeof body !== "object" ||
          body === null ||
          !("telegramId" in body) ||
          typeof body.telegramId !== "number" ||
          !Number.isSafeInteger(body.telegramId) ||
          body.telegramId <= 0
        ) {
          throw APIError.from(
            "BAD_REQUEST",
            ERROR_CODES.BOT_PROVISIONING_ID_REQUIRED
          );
        }
        const lastName = "lastName" in body ? body.lastName : undefined;
        if (
          !("firstName" in body) ||
          typeof body.firstName !== "string" ||
          !body.firstName.trim() ||
          (lastName !== undefined && typeof lastName !== "string")
        ) {
          throw APIError.from(
            "BAD_REQUEST",
            ERROR_CODES.BOT_PROVISIONING_NAME_REQUIRED
          );
        }

        const username =
          "username" in body &&
          typeof body.username === "string" &&
          /^[A-Za-z0-9_]{1,32}$/u.test(body.username)
            ? body.username
            : undefined;
        const user = await findOrCreateTelegramUser(ctx, {
          identity: { telegramId: String(body.telegramId), username },
          userData: {
            name: lastName ? `${body.firstName} ${lastName}` : body.firstName,
          },
          method: "telegram-bot-provisioning",
          allowCreate: config.autoCreateUser,
          notFound: ERROR_CODES.USER_CREATION_DISABLED,
        });

        return ctx.json({ userId: user.id });
      }
    ),
  };
}
