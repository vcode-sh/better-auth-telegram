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
  added_to_attachment_menu?: boolean;
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
  /** Present when the Mini App was opened from a chat join request. */
  chat_join_request_query_id?: string;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  hash: string;
  query_id?: string;
  receiver?: TelegramMiniAppUser;
  /**
   * Ed25519 signature for third-party validation without the bot token.
   * Part of the signed data, so the HMAC `hash` check covers it as well.
   */
  signature?: string;
  start_param?: string;
  user?: TelegramMiniAppUser;
}

/**
 * JWT ID token claims from Telegram OIDC.
 *
 * Profile claims (`id`, names, `picture`, `preferred_username`) need the
 * `profile` scope, and Telegram omits them for bots that sign ID tokens with
 * EdDSA or ES256K.
 */
export interface TelegramOIDCClaims {
  aud: string;
  exp: number;
  family_name?: string;
  given_name?: string;
  iat: number;
  /**
   * Telegram user id, the same number the Login Widget and Mini Apps report.
   * Telegram sends it as a string (e.g. `"8306595751"`).
   */
  id?: string;
  iss: string;
  name?: string;
  nonce?: string;
  /** Digits only, without a leading `+` (requires the `phone` scope). */
  phone_number?: string;
  phone_number_verified?: boolean;
  picture?: string;
  preferred_username?: string;
  /**
   * Subject: a user identifier scoped to one bot — the same Telegram user
   * gets a different `sub` from each bot. Not the Telegram user id.
   */
  sub: string;
}

/**
 * Configuration options for Telegram OIDC authentication
 */
export interface TelegramOIDCOptions {
  /**
   * Client ID shown in @BotFather (your bot > Login Widget) — the bot's id.
   * If omitted, the id part of `botToken` is used.
   *
   * Switching a bot to OpenID Connect permanently disables its legacy Login
   * Widget, so a deployment that also serves the Login Widget needs a second
   * bot for OIDC: set this to that bot's id.
   */
  clientId?: string;

  /**
   * Client Secret shown in @BotFather (your bot > Login Widget) after
   * switching the bot to OpenID Connect. This is NOT the bot token.
   * Required; OIDC logins fail until it is set.
   */
  clientSecret?: string;

  /**
   * Reject client-submitted ID tokens (`POST /sign-in/social` or
   * `/link-social` with `idToken`), leaving only the redirect flow.
   * @default false
   */
  disableIdTokenSignIn?: boolean;

  /**
   * Only sign in existing users; never create a user from Telegram OIDC.
   * @default false
   */
  disableSignUp?: boolean;

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
  botToken?: string;

  /**
   * Bot username (without @)
   * Used for generating the login widget
   */
  botUsername?: string;

  /**
   * Enable Login Widget endpoints (signin, link, unlink).
   * When false, Widget endpoints are not registered and Telegram-specific
   * user/account schema fields are omitted (unless Mini App is enabled).
   * @default true
   */
  loginWidget?: boolean;

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
     * Verify the initData signature before signing users in.
     * Turning this off lets anyone sign in as any Telegram user; only do it
     * in tests.
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

  /**
   * Marks a deployment that uses a bot from Telegram's test environment.
   * Purely informational: it is returned by `GET /telegram/config` so the
   * client can tell, and verification is unchanged (HMAC only depends on the
   * bot token). Telegram documents no test variant of the Login Widget or of
   * OIDC (oauth.telegram.org); a warning is logged if OIDC is enabled.
   * @default false
   */
  testMode?: boolean;
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
