import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";
import type { TelegramPluginConfig } from "./plugin-config";

/**
 * The Telegram columns. Built per plugin instance and typed with literal
 * types (not widened to `BetterAuthPluginDBSchema`), so Better Auth infers
 * them on `session.user`, server and client, as it does for its own plugins'
 * schemas.
 */
function telegramSchema() {
  return {
    user: {
      fields: {
        telegramId: {
          type: "string",
          required: false,
          unique: false,
          // Every Login Widget / Mini App sign-in looks users up by it.
          index: true,
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
  } satisfies BetterAuthPluginDBSchema;
}

export type TelegramSchema = ReturnType<typeof telegramSchema>;

/**
 * Creates the conditional Telegram schema extension.
 *
 * Adds `telegramId`, `telegramUsername`, `telegramPhoneNumber` to the `user` table
 * and `telegramId`, `telegramUsername` to the `account` table — but only when
 * Login Widget or Mini App flows are enabled. OIDC-only setups skip these fields.
 * The type always carries them: they are optional, and simply never set in
 * OIDC-only mode.
 */
export function createTelegramSchema(
  config: TelegramPluginConfig
): TelegramSchema | undefined {
  if (!(config.widgetEnabled || config.miniAppEnabled)) {
    return;
  }
  return telegramSchema();
}
