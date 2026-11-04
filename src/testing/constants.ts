/** Test fixtures are independent of production constants so wrong URLs cannot agree by accident. */
export const BOT_TOKEN = "123456789:AAtesttokentesttokentesttokentest";
export const BOT_ID = "123456789";
export const BASE_URL = "http://localhost:3000";
export const TELEGRAM_ISSUER = "https://oauth.telegram.org";
export const TELEGRAM_AUTHORIZATION_ENDPOINT =
  "https://oauth.telegram.org/auth";
export const TELEGRAM_TOKEN_ENDPOINT = "https://oauth.telegram.org/token";
export const TELEGRAM_JWKS_URI =
  "https://oauth.telegram.org/.well-known/jwks.json";

/** A Mini App signature field, included in the HMAC input as Telegram sends it. */
export const MINI_APP_SIGNATURE =
  "kXz3oVbV0wL3n0rZt7x1Qq9oX2y4m6n8p0r2t4v6x8z0B2D4F6H8J0L2N4P6R8T0V2X4Z6b8d0f2h4j6l8n0pA";
