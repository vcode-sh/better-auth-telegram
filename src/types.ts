/**
 * Data returned by Telegram Login Widget
 */
export interface TelegramAuthData {
  auth_date: number;
  first_name: string;
  hash: string;
  id: number;
  last_name?: string;
  photo_url?: string;
  username?: string;
}

/**
 * User object from Telegram Mini Apps
 */
export interface TelegramMiniAppUser {
  allows_write_to_pm?: boolean;
  first_name: string;
  id: number;
  is_bot?: boolean;
  is_premium?: boolean;
  language_code?: string;
  last_name?: string;
  photo_url?: string;
  username?: string;
}

/**
 * Chat object from Telegram Mini Apps
 */
export interface TelegramMiniAppChat {
  id: number;
  photo_url?: string;
  title?: string;
  type: string;
  username?: string;
}

/**
 * Complete data from Telegram Mini Apps initData
 */
export interface TelegramMiniAppData {
  auth_date: number;
  can_send_after?: number;
  chat?: TelegramMiniAppChat;
  chat_instance?: string;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  hash: string;
  query_id?: string;
  receiver?: TelegramMiniAppUser;
  start_param?: string;
  user?: TelegramMiniAppUser;
}

/**
 * JWT ID token claims from Telegram OIDC
 */
export interface TelegramOIDCClaims {
  aud: string;
  exp: number;
  iat: number;
  iss: string;
  name?: string;
  phone_number?: string;
  picture?: string;
  preferred_username?: string;
  sub: string;
}

/**
 * Configuration options for Telegram OIDC authentication
 */
export interface TelegramOIDCOptions {
  /**
   * Enable Telegram OIDC support
   * @default false
   */
  enabled?: boolean;

  /**
   * Custom function to map OIDC claims to user object
   */
  mapOIDCProfileToUser?: (claims: TelegramOIDCClaims) => {
    name?: string;
    email?: string;
    image?: string;
    [key: string]: any;
  };

  /**
   * Request bot access (adds "telegram:bot_access" scope)
   * @default false
   */
  requestBotAccess?: boolean;

  /**
   * Request phone number (adds "phone" scope)
   * @default false
   */
  requestPhone?: boolean;

  /**
   * Additional scopes beyond "openid"
   * @default ["profile"]
   */
  scopes?: string[];
}

/**
 * Configuration options for the Telegram plugin
 */
export interface TelegramPluginOptions {
  /**
   * Allow users to link their Telegram account to existing account
   * @default true
   */
  allowUserToLink?: boolean;

  /**
   * Automatically create user if doesn't exist
   * @default true
   */
  autoCreateUser?: boolean;
  /**
   * Bot token obtained from @BotFather
   * Used for verifying authentication data
   */
  botToken: string;

  /**
   * Bot username (without @)
   * Used for generating the login widget
   */
  botUsername: string;

  /**
   * Custom function to map Telegram data to user object
   */
  mapTelegramDataToUser?: (data: TelegramAuthData) => {
    name?: string;
    email?: string;
    image?: string;
    [key: string]: any;
  };

  /**
   * Maximum age of auth_date in seconds
   * Prevents replay attacks
   * @default 86400 (24 hours)
   */
  maxAuthAge?: number;

  /**
   * Telegram Mini Apps configuration
   */
  miniApp?: {
    /**
     * Enable Telegram Mini Apps support
     * @default false
     */
    enabled?: boolean;

    /**
     * Validate initData from Mini Apps
     * @default true
     */
    validateInitData?: boolean;

    /**
     * Allow automatic sign-in from Mini Apps
     * @default true
     */
    allowAutoSignin?: boolean;

    /**
     * Custom function to map Mini App user data to user object
     */
    mapMiniAppDataToUser?: (data: TelegramMiniAppUser) => {
      name?: string;
      email?: string;
      image?: string;
      [key: string]: any;
    };
  };

  /**
   * Telegram OIDC (OpenID Connect) configuration
   * Uses standard OAuth 2.0 Authorization Code flow with PKCE
   * via oauth.telegram.org
   */
  oidc?: TelegramOIDCOptions;
}

/**
 * Additional fields to add to the user table
 */
export interface TelegramUserFields {
  telegramId?: string;
  telegramPhoneNumber?: string;
  telegramUsername?: string;
}

/**
 * Additional fields to add to the account table
 */
export interface TelegramAccountFields {
  telegramId: string;
  telegramUsername?: string;
}

/**
 * Account record as returned by the Better Auth adapter
 */
export interface TelegramAccountRecord {
  accountId: string;
  id: string;
  providerId: string;
  telegramId?: string;
  telegramUsername?: string;
  userId: string;
}
