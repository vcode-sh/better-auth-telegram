/**
 * Data returned by Telegram Login Widget
 */
export interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * User object from Telegram Mini Apps
 */
export interface TelegramMiniAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  is_bot?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

/**
 * Chat object from Telegram Mini Apps
 */
export interface TelegramMiniAppChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  photo_url?: string;
}

/**
 * Complete data from Telegram Mini Apps initData
 */
export interface TelegramMiniAppData {
  user?: TelegramMiniAppUser;
  receiver?: TelegramMiniAppUser;
  chat?: TelegramMiniAppChat;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  query_id?: string;
  auth_date: number;
  hash: string;
}

/**
 * Configuration options for the Telegram plugin
 */
export interface TelegramPluginOptions {
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
   * Maximum age of auth_date in seconds
   * Prevents replay attacks
   * @default 86400 (24 hours)
   */
  maxAuthAge?: number;

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
}

/**
 * Additional fields to add to the user table
 */
export interface TelegramUserFields {
  telegramId?: string;
  telegramUsername?: string;
}

/**
 * Additional fields to add to the account table
 */
export interface TelegramAccountFields {
  telegramId: string;
  telegramUsername?: string;
}
