export const ERROR_CODES = {
  BOT_TOKEN_REQUIRED: "Telegram plugin: botToken is required",
  BOT_USERNAME_REQUIRED: "Telegram plugin: botUsername is required",
  INVALID_AUTH_DATA: "Invalid Telegram auth data",
  INVALID_AUTHENTICATION: "Invalid Telegram authentication",
  USER_CREATION_DISABLED: "User not found and auto-create is disabled",
  NOT_AUTHENTICATED: "Not authenticated",
  LINKING_DISABLED: "Linking Telegram accounts is disabled",
  TELEGRAM_ALREADY_LINKED_OTHER:
    "This Telegram account is already linked to another user",
  TELEGRAM_ALREADY_LINKED_SELF:
    "This Telegram account is already linked to your account",
  NOT_LINKED: "No Telegram account linked",
  INIT_DATA_REQUIRED: "initData is required and must be a string",
  INVALID_MINI_APP_INIT_DATA: "Invalid Mini App initData",
  INVALID_MINI_APP_DATA_STRUCTURE: "Invalid Mini App data structure",
  NO_USER_IN_INIT_DATA: "No user data in initData",
  MINI_APP_AUTO_SIGNIN_DISABLED:
    "User not found and auto-signin is disabled for Mini Apps",
} as const;

export const SUCCESS_MESSAGES = {
  TELEGRAM_LINKED: "Telegram account linked successfully",
  TELEGRAM_UNLINKED: "Telegram account unlinked successfully",
} as const;

export const PLUGIN_ID = "telegram";

export const DEFAULT_MAX_AUTH_AGE = 86400;
