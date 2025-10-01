import { createHmac, createHash } from "crypto";
import type { TelegramAuthData } from "./types";

/**
 * Verifies the authenticity of Telegram authentication data
 * @param data - Authentication data from Telegram Login Widget
 * @param botToken - Bot token from @BotFather
 * @param maxAge - Maximum age of auth in seconds (default: 24 hours)
 * @returns true if data is valid, false otherwise
 */
export function verifyTelegramAuth(
  data: TelegramAuthData,
  botToken: string,
  maxAge: number = 86400
): boolean {
  // Extract hash from data
  const { hash, ...dataWithoutHash } = data;

  // Check auth_date is not too old
  const authDate = dataWithoutHash.auth_date;
  const currentTime = Math.floor(Date.now() / 1000);

  if (currentTime - authDate > maxAge) {
    return false;
  }

  // Create data-check-string
  const dataCheckString = Object.keys(dataWithoutHash)
    .sort()
    .map((key) => {
      const value = dataWithoutHash[key as keyof typeof dataWithoutHash];
      return `${key}=${value}`;
    })
    .join("\n");

  // Create secret key: SHA256(bot_token)
  const secretKey = createHash("sha256")
    .update(botToken)
    .digest();

  // Calculate HMAC-SHA256
  const hmac = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Compare with received hash
  return hmac === hash;
}

/**
 * Validates that required fields are present in Telegram auth data
 */
export function validateTelegramAuthData(
  data: any
): data is TelegramAuthData {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof data.id === "number" &&
    typeof data.first_name === "string" &&
    typeof data.auth_date === "number" &&
    typeof data.hash === "string"
  );
}
