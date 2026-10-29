/**
 * Error codes of the Telegram plugin. Shared by the server plugin and the
 * client entry (`better-auth-telegram/client`), so client code can match
 * `error.code` without importing server code.
 */
import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const TELEGRAM_ERROR_CODES = defineErrorCodes({
  BOT_TOKEN_REQUIRED: "Telegram plugin: botToken is required",
  BOT_USERNAME_REQUIRED: "Telegram plugin: botUsername is required",
  OIDC_CLIENT_ID_REQUIRED:
    "Telegram OIDC: oidc.clientId (or botToken) is required before starting an OIDC login",
  OIDC_CLIENT_SECRET_REQUIRED:
    "Telegram OIDC: oidc.clientSecret is required before starting an OIDC login. It is the Client Secret shown in @BotFather (your bot > Login Widget), not the bot token",
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
  DIFFERENT_TELEGRAM_ACCOUNT_LINKED:
    "A different Telegram account is already linked to your account",
  ACCOUNT_NOT_LINKED:
    "A user with this Telegram account exists, but the account is not linked and account linking does not allow linking it on sign-in",
  CANNOT_UNLINK_LAST_ACCOUNT:
    "Cannot unlink Telegram: it is the only way to sign in to this account",
  USER_CREATION_REJECTED: "User creation was rejected",
  ORPHANED_ACCOUNT: "Telegram account references a user that does not exist",
  INIT_DATA_REQUIRED: "initData is required and must be a string",
  INVALID_MINI_APP_INIT_DATA: "Invalid Mini App initData",
  INVALID_MINI_APP_DATA_STRUCTURE: "Invalid Mini App data structure",
  NO_USER_IN_INIT_DATA: "No user data in initData",
  MINI_APP_AUTO_SIGNIN_DISABLED:
    "User not found and auto-signin is disabled for Mini Apps",
  PLACEHOLDER_EMAIL_RESERVED:
    "Telegram placeholder email addresses are reserved for Telegram sign-in",
});
