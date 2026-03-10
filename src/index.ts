import type { BetterAuthPlugin } from "better-auth";
import { createConfigEndpoint } from "./config-endpoint";
import { ERROR_CODES, PLUGIN_ID } from "./constants";
import {
  createMiniAppEndpoints,
  getMiniAppRateLimits,
} from "./miniapp-endpoints";
import { createTelegramOIDCProvider } from "./oidc";
import { createPluginConfig } from "./plugin-config";
import { createTelegramSchema } from "./schema";
import type { TelegramPluginOptions } from "./types";
import { createWidgetEndpoints, getWidgetRateLimits } from "./widget-endpoints";

// biome-ignore lint/performance/noBarrelFile: Public API re-export
export { createTelegramOIDCProvider } from "./oidc";
export type { TelegramPluginConfig } from "./plugin-config";
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
  const config = createPluginConfig(options);

  return {
    id: PLUGIN_ID,

    // Inject OIDC provider into better-auth's social providers
    ...(config.oidcEnabled
      ? {
          init: (ctx) => ({
            context: {
              socialProviders: [
                createTelegramOIDCProvider(config.botToken, config.oidc!),
                ...ctx.socialProviders,
              ],
            },
          }),
        }
      : {}),

    schema: createTelegramSchema(config),

    endpoints: {
      ...(config.widgetEnabled ? createWidgetEndpoints(config) : {}),
      ...(config.miniAppEnabled ? createMiniAppEndpoints(config) : {}),
      ...createConfigEndpoint(config),
    },

    $ERROR_CODES: ERROR_CODES,

    rateLimit: [
      ...(config.widgetEnabled ? getWidgetRateLimits() : []),
      ...(config.miniAppEnabled ? getMiniAppRateLimits() : []),
    ],
  } satisfies BetterAuthPlugin;
};

declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    telegram: {
      creator: typeof telegram;
    };
  }
}
