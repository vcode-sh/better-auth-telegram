import { describe, it, expect, beforeEach, vi } from "vitest";
import { verifyTelegramAuth, validateTelegramAuthData } from "./verify";
import { createHash, createHmac } from "crypto";
import type { TelegramAuthData } from "./types";

describe("verifyTelegramAuth", () => {
  const BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz";
  let validAuthData: TelegramAuthData;

  beforeEach(() => {
    // Create valid auth data for each test
    const currentTime = Math.floor(Date.now() / 1000);
    const dataWithoutHash = {
      id: 123456789,
      first_name: "John",
      last_name: "Doe",
      username: "johndoe",
      photo_url: "https://example.com/photo.jpg",
      auth_date: currentTime,
    };

    // Generate valid hash
    const dataCheckString = Object.keys(dataWithoutHash)
      .sort()
      .map((key) => `${key}=${dataWithoutHash[key as keyof typeof dataWithoutHash]}`)
      .join("\n");

    const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
    const hash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    validAuthData = {
      ...dataWithoutHash,
      hash,
    };
  });

  describe("Valid authentication", () => {
    it("should return true for valid auth data", () => {
      const result = verifyTelegramAuth(validAuthData, BOT_TOKEN);
      expect(result).toBe(true);
    });

    it("should verify data with only required fields", () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const minimalData = {
        id: 123456789,
        first_name: "John",
        auth_date: currentTime,
      };

      const dataCheckString = Object.keys(minimalData)
        .sort()
        .map((key) => `${key}=${minimalData[key as keyof typeof minimalData]}`)
        .join("\n");

      const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      const result = verifyTelegramAuth(
        { ...minimalData, hash },
        BOT_TOKEN
      );
      expect(result).toBe(true);
    });

    it("should verify data with all optional fields", () => {
      // validAuthData already has all fields
      const result = verifyTelegramAuth(validAuthData, BOT_TOKEN);
      expect(result).toBe(true);
    });

    it("should accept auth data within maxAge", () => {
      const result = verifyTelegramAuth(validAuthData, BOT_TOKEN, 86400);
      expect(result).toBe(true);
    });

    it("should accept auth data from 1 second ago", () => {
      const oneSecondAgo = Math.floor(Date.now() / 1000) - 1;
      const data = { ...validAuthData, auth_date: oneSecondAgo };

      // Regenerate hash with new auth_date
      const dataWithoutHash = { ...data };
      delete (dataWithoutHash as any).hash;

      const dataCheckString = Object.keys(dataWithoutHash)
        .sort()
        .map((key) => `${key}=${dataWithoutHash[key as keyof typeof dataWithoutHash]}`)
        .join("\n");

      const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      const result = verifyTelegramAuth({ ...data, hash }, BOT_TOKEN, 86400);
      expect(result).toBe(true);
    });
  });

  describe("Invalid HMAC", () => {
    it("should return false for tampered id", () => {
      const tamperedData = { ...validAuthData, id: 999999999 };
      const result = verifyTelegramAuth(tamperedData, BOT_TOKEN);
      expect(result).toBe(false);
    });

    it("should return false for tampered first_name", () => {
      const tamperedData = { ...validAuthData, first_name: "Hacker" };
      const result = verifyTelegramAuth(tamperedData, BOT_TOKEN);
      expect(result).toBe(false);
    });

    it("should return false for tampered username", () => {
      const tamperedData = { ...validAuthData, username: "hacker" };
      const result = verifyTelegramAuth(tamperedData, BOT_TOKEN);
      expect(result).toBe(false);
    });

    it("should return false for completely wrong hash", () => {
      const tamperedData = {
        ...validAuthData,
        hash: "0000000000000000000000000000000000000000000000000000000000000000",
      };
      const result = verifyTelegramAuth(tamperedData, BOT_TOKEN);
      expect(result).toBe(false);
    });

    it("should return false for empty hash", () => {
      const tamperedData = { ...validAuthData, hash: "" };
      const result = verifyTelegramAuth(tamperedData, BOT_TOKEN);
      expect(result).toBe(false);
    });

    it("should return false with wrong bot token", () => {
      const result = verifyTelegramAuth(validAuthData, "wrong_token");
      expect(result).toBe(false);
    });

    it("should be case-sensitive for hash", () => {
      const uppercaseHash = { ...validAuthData, hash: validAuthData.hash.toUpperCase() };
      const result = verifyTelegramAuth(uppercaseHash, BOT_TOKEN);
      expect(result).toBe(false);
    });
  });

  describe("Expired auth_date", () => {
    it("should return false for auth data older than maxAge", () => {
      const oldTime = Math.floor(Date.now() / 1000) - 86401; // 1 day + 1 second
      const oldData = { ...validAuthData, auth_date: oldTime };

      // Regenerate valid hash for old data
      const dataWithoutHash = { ...oldData };
      delete (dataWithoutHash as any).hash;

      const dataCheckString = Object.keys(dataWithoutHash)
        .sort()
        .map((key) => `${key}=${dataWithoutHash[key as keyof typeof dataWithoutHash]}`)
        .join("\n");

      const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      const result = verifyTelegramAuth({ ...oldData, hash }, BOT_TOKEN, 86400);
      expect(result).toBe(false);
    });

    it("should respect custom maxAge parameter", () => {
      const sixtySecondsAgo = Math.floor(Date.now() / 1000) - 60;
      const data = { ...validAuthData, auth_date: sixtySecondsAgo };

      // Regenerate hash
      const dataWithoutHash = { ...data };
      delete (dataWithoutHash as any).hash;

      const dataCheckString = Object.keys(dataWithoutHash)
        .sort()
        .map((key) => `${key}=${dataWithoutHash[key as keyof typeof dataWithoutHash]}`)
        .join("\n");

      const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      // Should fail with maxAge of 30 seconds
      const result = verifyTelegramAuth({ ...data, hash }, BOT_TOKEN, 30);
      expect(result).toBe(false);
    });

    it("should accept auth data exactly at maxAge boundary", () => {
      const exactlyMaxAge = Math.floor(Date.now() / 1000) - 3600; // exactly 1 hour
      const data = { ...validAuthData, auth_date: exactlyMaxAge };

      // Regenerate hash
      const dataWithoutHash = { ...data };
      delete (dataWithoutHash as any).hash;

      const dataCheckString = Object.keys(dataWithoutHash)
        .sort()
        .map((key) => `${key}=${dataWithoutHash[key as keyof typeof dataWithoutHash]}`)
        .join("\n");

      const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      const result = verifyTelegramAuth({ ...data, hash }, BOT_TOKEN, 3600);
      expect(result).toBe(true);
    });
  });

  describe("Data ordering", () => {
    it("should verify regardless of field order in original data", () => {
      // Create data with fields in different order
      const unorderedData = {
        hash: validAuthData.hash,
        username: validAuthData.username,
        id: validAuthData.id,
        auth_date: validAuthData.auth_date,
        first_name: validAuthData.first_name,
        photo_url: validAuthData.photo_url,
        last_name: validAuthData.last_name,
      } as TelegramAuthData;

      const result = verifyTelegramAuth(unorderedData, BOT_TOKEN);
      expect(result).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("should handle auth_date as 0 (Unix epoch)", () => {
      const epochData = { ...validAuthData, auth_date: 0 };

      // Regenerate hash
      const dataWithoutHash = { ...epochData };
      delete (dataWithoutHash as any).hash;

      const dataCheckString = Object.keys(dataWithoutHash)
        .sort()
        .map((key) => `${key}=${dataWithoutHash[key as keyof typeof dataWithoutHash]}`)
        .join("\n");

      const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      // Should fail because it's way too old
      const result = verifyTelegramAuth({ ...epochData, hash }, BOT_TOKEN, 86400);
      expect(result).toBe(false);
    });

    it("should handle special characters in names", () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const specialCharsData = {
        id: 123456789,
        first_name: "José María",
        last_name: "O'Brien-Smith",
        auth_date: currentTime,
      };

      // Generate valid hash
      const dataCheckString = Object.keys(specialCharsData)
        .sort()
        .map((key) => `${key}=${specialCharsData[key as keyof typeof specialCharsData]}`)
        .join("\n");

      const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      const result = verifyTelegramAuth(
        { ...specialCharsData, hash },
        BOT_TOKEN
      );
      expect(result).toBe(true);
    });

    it("should handle Unicode in usernames", () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const unicodeData = {
        id: 123456789,
        first_name: "User",
        username: "用户名",
        auth_date: currentTime,
      };

      // Generate valid hash
      const dataCheckString = Object.keys(unicodeData)
        .sort()
        .map((key) => `${key}=${unicodeData[key as keyof typeof unicodeData]}`)
        .join("\n");

      const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      const result = verifyTelegramAuth({ ...unicodeData, hash }, BOT_TOKEN);
      expect(result).toBe(true);
    });

    it("should handle very long photo URLs", () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const longUrlData = {
        id: 123456789,
        first_name: "User",
        photo_url: "https://example.com/" + "a".repeat(1000) + ".jpg",
        auth_date: currentTime,
      };

      // Generate valid hash
      const dataCheckString = Object.keys(longUrlData)
        .sort()
        .map((key) => `${key}=${longUrlData[key as keyof typeof longUrlData]}`)
        .join("\n");

      const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      const result = verifyTelegramAuth({ ...longUrlData, hash }, BOT_TOKEN);
      expect(result).toBe(true);
    });
  });
});

describe("validateTelegramAuthData", () => {
  describe("Valid data", () => {
    it("should return true for valid minimal auth data", () => {
      const data = {
        id: 123456789,
        first_name: "John",
        auth_date: 1234567890,
        hash: "abc123",
      };

      expect(validateTelegramAuthData(data)).toBe(true);
    });

    it("should return true for valid complete auth data", () => {
      const data = {
        id: 123456789,
        first_name: "John",
        last_name: "Doe",
        username: "johndoe",
        photo_url: "https://example.com/photo.jpg",
        auth_date: 1234567890,
        hash: "abc123",
      };

      expect(validateTelegramAuthData(data)).toBe(true);
    });
  });

  describe("Invalid data", () => {
    it("should return false for null", () => {
      expect(validateTelegramAuthData(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(validateTelegramAuthData(undefined)).toBe(false);
    });

    it("should return false for string", () => {
      expect(validateTelegramAuthData("not an object")).toBe(false);
    });

    it("should return false for number", () => {
      expect(validateTelegramAuthData(123)).toBe(false);
    });

    it("should return false for array", () => {
      expect(validateTelegramAuthData([])).toBe(false);
    });

    it("should return false when missing id", () => {
      const data = {
        first_name: "John",
        auth_date: 1234567890,
        hash: "abc123",
      };

      expect(validateTelegramAuthData(data)).toBe(false);
    });

    it("should return false when missing first_name", () => {
      const data = {
        id: 123456789,
        auth_date: 1234567890,
        hash: "abc123",
      };

      expect(validateTelegramAuthData(data)).toBe(false);
    });

    it("should return false when missing auth_date", () => {
      const data = {
        id: 123456789,
        first_name: "John",
        hash: "abc123",
      };

      expect(validateTelegramAuthData(data)).toBe(false);
    });

    it("should return false when missing hash", () => {
      const data = {
        id: 123456789,
        first_name: "John",
        auth_date: 1234567890,
      };

      expect(validateTelegramAuthData(data)).toBe(false);
    });

    it("should return false when id is string", () => {
      const data = {
        id: "123456789",
        first_name: "John",
        auth_date: 1234567890,
        hash: "abc123",
      };

      expect(validateTelegramAuthData(data)).toBe(false);
    });

    it("should return false when first_name is number", () => {
      const data = {
        id: 123456789,
        first_name: 123,
        auth_date: 1234567890,
        hash: "abc123",
      };

      expect(validateTelegramAuthData(data)).toBe(false);
    });

    it("should return false when auth_date is string", () => {
      const data = {
        id: 123456789,
        first_name: "John",
        auth_date: "1234567890",
        hash: "abc123",
      };

      expect(validateTelegramAuthData(data)).toBe(false);
    });

    it("should return false when hash is number", () => {
      const data = {
        id: 123456789,
        first_name: "John",
        auth_date: 1234567890,
        hash: 123,
      };

      expect(validateTelegramAuthData(data)).toBe(false);
    });

    it("should return false for empty object", () => {
      expect(validateTelegramAuthData({})).toBe(false);
    });
  });

  describe("Type narrowing", () => {
    it("should narrow type to TelegramAuthData when true", () => {
      const data: unknown = {
        id: 123456789,
        first_name: "John",
        auth_date: 1234567890,
        hash: "abc123",
      };

      if (validateTelegramAuthData(data)) {
        // TypeScript should know this is TelegramAuthData now
        expect(data.id).toBe(123456789);
        expect(data.first_name).toBe("John");
        expect(data.auth_date).toBe(1234567890);
        expect(data.hash).toBe("abc123");
      }
    });
  });
});
