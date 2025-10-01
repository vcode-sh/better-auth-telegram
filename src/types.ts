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
