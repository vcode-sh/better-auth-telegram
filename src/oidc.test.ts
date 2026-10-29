// @vitest-environment node
/**
 * Provider rules that are awkward to reach through a full sign-in. The
 * authorization URL, token exchange, ID token checks and account binding are
 * covered against a real Better Auth instance in oidc.integration.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramOIDCProvider } from "./oidc";
import {
  BOT_TOKEN,
  mockTelegramOIDC,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";
import type { TelegramOIDCClaims } from "./types";

const CLIENT_SECRET = "client-secret-from-botfather";
const authorizationRequest = {
  state: "state",
  codeVerifier: "verifier",
  redirectURI: "https://example.com/api/auth/callback/telegram-oidc",
};

describe("client credentials", () => {
  it("never falls back to the bot token as the client secret", () => {
    // Telegram rejects the bot token; v3 requires oidc.clientSecret.
    const provider = createTelegramOIDCProvider(BOT_TOKEN, {});

    expect(() => provider.createAuthorizationURL(authorizationRequest)).toThrow(
      "clientSecret is required"
    );
  });

  it("refuses to start a login with an empty client_id", () => {
    const provider = createTelegramOIDCProvider("", {
      clientSecret: CLIENT_SECRET,
    });

    expect(() => provider.createAuthorizationURL(authorizationRequest)).toThrow(
      "clientId is required"
    );
  });
});

describe("accountSubject", () => {
  const profile = telegramClaims() as unknown as TelegramOIDCClaims;

  it.each([
    ["empty", ""],
    ["numeric", 123],
  ])("refuses to key an account by an %s sub", (_kind, sub) => {
    const provider = createTelegramOIDCProvider(BOT_TOKEN, {
      clientSecret: CLIENT_SECRET,
    });

    expect(() =>
      provider.accountSubject({
        tokens: {},
        profile: { ...profile, sub } as unknown as TelegramOIDCClaims,
      })
    ).toThrow("ID token has no subject");
  });
});

describe("getUserInfo", () => {
  let telegram: TelegramOIDCMock;

  beforeEach(async () => {
    telegram = await mockTelegramOIDC();
  });

  afterEach(() => {
    telegram.restore();
    vi.restoreAllMocks();
  });

  const provider = (options = {}) =>
    createTelegramOIDCProvider(BOT_TOKEN, {
      clientSecret: CLIENT_SECRET,
      ...options,
    });

  it("names the user from given and family name, then username, when `name` is absent", async () => {
    const fromParts = await provider().getUserInfo({
      idToken: await telegram.sign(telegramClaims({ name: undefined })),
    });
    const fromUsername = await provider().getUserInfo({
      idToken: await telegram.sign({ sub: "1", preferred_username: "ann" }),
    });

    expect(fromParts?.user.name).toBe("Ann Example");
    expect(fromUsername?.user.name).toBe("ann");
  });

  it("applies mapOIDCProfileToUser but never lets it set the user id", async () => {
    const result = await provider({
      mapOIDCProfileToUser: (claims: TelegramOIDCClaims) => ({
        id: "hijack",
        email: `${claims.preferred_username}@example.com`,
      }),
    }).getUserInfo({ idToken: await telegram.sign(telegramClaims()) });

    expect(result?.user.email).toBe("ann@example.com");
    expect(result?.user).not.toHaveProperty("id");
  });

  it("warns that the bot's signing algorithm drops profile claims", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await provider().getUserInfo({
      idToken: await telegram.sign({ sub: "12224742808376279442" }),
    });

    expect(result).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no profile claims"),
      expect.stringContaining("EdDSA"),
      expect.stringContaining("RS256 or ES256")
    );
  });
});
