import { DEFAULT_MAX_AUTH_AGE, ERROR_CODES } from "./constants";
import type {
  TelegramAuthData,
  TelegramMiniAppUser,
  TelegramOIDCOptions,
  TelegramPluginOptions,
} from "./types";

/**
 * Resolved configuration for the Telegram plugin.
 * Created from `TelegramPluginOptions` with all defaults applied.
 */
export interface TelegramPluginConfig {
  allowUserToLink: boolean;
  autoCreateUser: boolean;
  botToken: string;
  botUsername: string;
  mapMiniAppDataToUser?: (data: TelegramMiniAppUser) => {
    name?: string;
    email?: string;
    image?: string;
    [key: string]: any;
  };
  mapTelegramDataToUser?: (data: TelegramAuthData) => {
    name?: string;
    email?: string;
    image?: string;
    [key: string]: any;
  };
  maxAuthAge: number;
  miniAppAllowAutoSignin: boolean;
  miniAppEnabled: boolean;
  miniAppValidateInitData: boolean;
  oidc?: TelegramOIDCOptions;
  oidcEnabled: boolean;
  testMode: boolean;
  widgetEnabled: boolean;
}

/**
 * Parses and validates `TelegramPluginOptions`, applying defaults.
 * Throws if required fields (`botToken`, `botUsername`) are missing.
 */
export function createPluginConfig(
  options: TelegramPluginOptions
): TelegramPluginConfig {
  const {
    botToken,
    botUsername,
    allowUserToLink = true,
    autoCreateUser = true,
    loginWidget,
    maxAuthAge = DEFAULT_MAX_AUTH_AGE,
    mapTelegramDataToUser,
    miniApp,
    oidc,
    testMode = false,
  } = options;

  if (!botToken) {
    throw new Error(ERROR_CODES.BOT_TOKEN_REQUIRED.message);
  }

  if (!botUsername) {
    throw new Error(ERROR_CODES.BOT_USERNAME_REQUIRED.message);
  }

  const widgetEnabled = loginWidget !== false;
  const miniAppEnabled = miniApp?.enabled ?? false;
  const oidcEnabled = oidc?.enabled ?? false;

  if (testMode && oidcEnabled) {
    console.warn(
      "[better-auth-telegram] testMode is enabled with OIDC. Telegram's OIDC endpoint (oauth.telegram.org) has no documented test variant — OIDC authentication may not work with test server bot tokens."
    );
  }

  return {
    botToken,
    botUsername,
    widgetEnabled,
    miniAppEnabled,
    oidcEnabled,
    testMode,
    allowUserToLink,
    autoCreateUser,
    maxAuthAge,
    miniAppValidateInitData: miniApp?.validateInitData ?? true,
    miniAppAllowAutoSignin: miniApp?.allowAutoSignin ?? true,
    mapTelegramDataToUser,
    mapMiniAppDataToUser: miniApp?.mapMiniAppDataToUser,
    oidc,
  };
}
