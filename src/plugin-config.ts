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
 * Parses `TelegramPluginOptions`, applies defaults, and reports credentials
 * missing from enabled flows. Credential use is guarded at runtime so
 * build-time environments can resolve secrets later.
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

  const widgetEnabled = loginWidget !== false;
  const miniAppEnabled = miniApp?.enabled ?? false;
  const oidcEnabled = oidc?.enabled ?? false;
  const resolvedBotToken = botToken ?? "";
  const resolvedBotUsername = botUsername ?? "";

  if ((widgetEnabled || miniAppEnabled) && !resolvedBotToken) {
    console.warn(
      `[better-auth-telegram] ${ERROR_CODES.BOT_TOKEN_REQUIRED.message}. The enabled HMAC flow will reject requests until it is configured.`
    );
  }

  if (widgetEnabled && !resolvedBotUsername) {
    console.warn(
      `[better-auth-telegram] ${ERROR_CODES.BOT_USERNAME_REQUIRED.message}. The Login Widget cannot be rendered until it is configured.`
    );
  }

  if (oidcEnabled && !(oidc?.clientId || resolvedBotToken)) {
    console.warn(
      "[better-auth-telegram] OIDC: clientId is required. Configure oidc.clientId or botToken before starting an OIDC login."
    );
  }

  if (oidcEnabled && !(oidc?.clientSecret || resolvedBotToken)) {
    console.warn(
      "[better-auth-telegram] OIDC: clientSecret is required. Configure oidc.clientSecret or botToken before starting an OIDC login."
    );
  }

  if (testMode && oidcEnabled) {
    console.warn(
      "[better-auth-telegram] testMode is enabled with OIDC. Telegram's OIDC endpoint (oauth.telegram.org) has no documented test variant — OIDC authentication may not work with test server bot tokens."
    );
  }

  return {
    botToken: resolvedBotToken,
    botUsername: resolvedBotUsername,
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
