import type { BetterAuthPlugin } from "better-auth";
import type { TelegramPluginConfig } from "./plugin-config";

/**
 * Creates the conditional Telegram schema extension.
 *
 * Adds `telegramId`, `telegramUsername`, `telegramPhoneNumber` to the `user` table
 * and `telegramId`, `telegramUsername` to the `account` table — but only when
 * Login Widget or Mini App flows are enabled. OIDC-only setups skip these fields.
 */
export function createTelegramSchema(
  config: TelegramPluginConfig
): BetterAuthPlugin["schema"] {
  if (!(config.widgetEnabled || config.miniAppEnabled)) {
    return undefined;
  }

  return {
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
  };
}
