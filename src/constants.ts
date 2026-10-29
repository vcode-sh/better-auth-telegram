import { TELEGRAM_ERROR_CODES } from "./error-codes";

export const ERROR_CODES = TELEGRAM_ERROR_CODES;

export const SUCCESS_MESSAGES = {
  TELEGRAM_LINKED: "Telegram account linked successfully",
  TELEGRAM_UNLINKED: "Telegram account unlinked successfully",
} as const;

export const PLUGIN_ID = "telegram";

export const DEFAULT_MAX_AUTH_AGE = 86400;

export const TELEGRAM_OIDC_PROVIDER_ID = "telegram-oidc";

/** Domains of the placeholder emails, keyed by namespace (provider id). */
export const PLACEHOLDER_EMAIL_DOMAINS = {
  [PLUGIN_ID]: `${PLUGIN_ID}.placeholder.invalid`,
  [TELEGRAM_OIDC_PROVIDER_ID]: `${TELEGRAM_OIDC_PROVIDER_ID}.placeholder.invalid`,
} as const;
export const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";
export const TELEGRAM_OIDC_AUTH_ENDPOINT = "https://oauth.telegram.org/auth";
export const TELEGRAM_OIDC_TOKEN_ENDPOINT = "https://oauth.telegram.org/token";
export const TELEGRAM_OIDC_JWKS_URI =
  "https://oauth.telegram.org/.well-known/jwks.json";
