import { DEFAULT_MAX_AUTH_AGE } from "./constants";
import type { TelegramAuthData, TelegramMiniAppData } from "./types";

const encoder = new TextEncoder();

function importHmacKey(key: Uint8Array, usage: "sign" | "verify") {
  return globalThis.crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

/**
 * Computes HMAC-SHA256 of data using the given key
 */
async function hmacSha256(key: Uint8Array, data: string): Promise<ArrayBuffer> {
  return globalThis.crypto.subtle.sign(
    "HMAC",
    await importHmacKey(key, "sign"),
    encoder.encode(data) as BufferSource
  );
}

/**
 * Computes SHA-256 hash of a string
 */
async function sha256(data: string): Promise<ArrayBuffer> {
  return await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(data) as BufferSource
  );
}

const HEX_SHA256 = /^[0-9a-f]{64}$/u;

/**
 * Checks a hex-encoded HMAC-SHA256 in constant time (Web Crypto `verify`).
 */
async function verifyHmacHex(
  key: Uint8Array,
  data: string,
  hexSignature: unknown
): Promise<boolean> {
  if (typeof hexSignature !== "string" || !HEX_SHA256.test(hexSignature)) {
    return false;
  }
  const signature = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    signature[i] = Number.parseInt(hexSignature.slice(i * 2, i * 2 + 2), 16);
  }
  return globalThis.crypto.subtle.verify(
    "HMAC",
    await importHmacKey(key, "verify"),
    signature as BufferSource,
    encoder.encode(data) as BufferSource
  );
}

/** Telegram's servers and ours may disagree slightly about the time. */
const MAX_CLOCK_SKEW_SECONDS = 60;

/**
 * `auth_date` must be a Unix time no older than `maxAge` and not in the future.
 */
function isFreshAuthDate(authDate: number, maxAge: number): boolean {
  if (!Number.isSafeInteger(authDate)) {
    return false;
  }
  const age = Math.floor(Date.now() / 1000) - authDate;
  return age <= maxAge && age >= -MAX_CLOCK_SKEW_SECONDS;
}

/** Code-unit order, as Telegram's "sorted alphabetically" check string uses. */
function byKey([a]: [string, unknown], [b]: [string, unknown]): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Verifies the authenticity of Telegram authentication data
 * @param data - Authentication data from Telegram Login Widget
 * @param botToken - Bot token from @BotFather
 * @param maxAge - Maximum age of auth in seconds (default: 24 hours)
 * @returns Promise that resolves to true if data is valid, false otherwise
 */
export async function verifyTelegramAuth(
  data: TelegramAuthData,
  botToken: string,
  maxAge = DEFAULT_MAX_AUTH_AGE
): Promise<boolean> {
  const { hash, ...dataWithoutHash } = data;

  if (!isFreshAuthDate(dataWithoutHash.auth_date, maxAge)) {
    return false;
  }

  // Data-check-string: every received field except hash, sorted by key.
  const entries = Object.entries(dataWithoutHash).map(
    ([key, value]) => [key, String(value)] as [string, string]
  );
  // A line break inside a field would let one signed field be re-split into
  // several (e.g. a different `id`); Telegram's values never contain one.
  if (
    entries.some(([key, value]) => key.includes("\n") || value.includes("\n"))
  ) {
    return false;
  }
  const dataCheckString = entries
    .sort(byKey)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // Secret key: SHA256(bot_token)
  const secretKey = new Uint8Array(await sha256(botToken));

  return verifyHmacHex(secretKey, dataCheckString, hash);
}

/**
 * Validates that required fields are present in Telegram auth data
 */
export function validateTelegramAuthData(data: any): data is TelegramAuthData {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof data.id === "number" &&
    typeof data.first_name === "string" &&
    typeof data.auth_date === "number" &&
    typeof data.hash === "string"
  );
}

/**
 * Parse initData string from Telegram Mini App
 * @param initData - URL-encoded initData string from Telegram.WebApp.initData
 * @returns Parsed Mini App data object
 */
export function parseMiniAppInitData(initData: string): TelegramMiniAppData {
  const params = new URLSearchParams(initData);
  const data: Partial<TelegramMiniAppData> & Record<string, unknown> = {};

  for (const [key, value] of params.entries()) {
    if (key === "user" || key === "receiver" || key === "chat") {
      // Parse JSON objects
      try {
        data[key] = JSON.parse(value);
      } catch {}
    } else if (key === "auth_date" || key === "can_send_after") {
      // Parse numbers
      data[key] = Number(value);
    } else {
      // Keep as string
      data[key] = value;
    }
  }

  return data as TelegramMiniAppData;
}

/**
 * Verifies the authenticity of Telegram Mini App initData
 * @param initData - Raw initData string from Telegram.WebApp.initData
 * @param botToken - Bot token from @BotFather
 * @param maxAge - Maximum age of auth in seconds (default: 24 hours)
 * @returns Promise that resolves to true if data is valid, false otherwise
 */
export async function verifyMiniAppInitData(
  initData: string,
  botToken: string,
  maxAge = DEFAULT_MAX_AUTH_AGE
): Promise<boolean> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    return false;
  }

  params.delete("hash");

  const authDate = params.get("auth_date");
  if (!(authDate && isFreshAuthDate(Number(authDate), maxAge))) {
    return false;
  }

  // Data-check-string: every received field except hash (signature
  // included), sorted by key.
  const dataCheckString = Array.from(params.entries())
    .sort(byKey)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // Secret key: HMAC-SHA256(key="WebAppData", data=bot_token)
  const secretKey = new Uint8Array(
    await hmacSha256(encoder.encode("WebAppData"), botToken)
  );

  return verifyHmacHex(secretKey, dataCheckString, hash);
}

/**
 * Validates that required fields are present in Mini App data
 */
export function validateMiniAppData(data: any): data is TelegramMiniAppData {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof data.auth_date === "number" &&
    typeof data.hash === "string" &&
    (data.user === undefined ||
      (typeof data.user === "object" &&
        typeof data.user.id === "number" &&
        typeof data.user.first_name === "string"))
  );
}
