import { createAuthEndpoint } from "better-auth/api";
import type { TelegramPluginConfig } from "./plugin-config";

/**
 * Creates the GET /telegram/config endpoint.
 * Always registered regardless of which flows are enabled.
 */
export function createConfigEndpoint(config: TelegramPluginConfig) {
  return {
    getTelegramConfig: createAuthEndpoint(
      "/telegram/config",
      {
        method: "GET",
      },
      async (ctx) =>
        ctx.json({
          botUsername: config.botUsername,
          loginWidgetEnabled: config.widgetEnabled,
          miniAppEnabled: config.miniAppEnabled,
          oidcEnabled: config.oidcEnabled,
          testMode: config.testMode,
        })
    ),
  };
}
