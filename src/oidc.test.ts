/**
 * @vitest-environment happy-dom
 */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TELEGRAM_OIDC_AUTH_ENDPOINT,
  TELEGRAM_OIDC_ISSUER,
  TELEGRAM_OIDC_JWKS_URI,
  TELEGRAM_OIDC_PROVIDER_ID,
  TELEGRAM_OIDC_TOKEN_ENDPOINT,
} from "./constants";
import { buildScopes, createTelegramOIDCProvider } from "./oidc";
import type { TelegramOIDCClaims } from "./types";

// Mock @better-fetch/fetch
vi.mock("@better-fetch/fetch", () => ({
  betterFetch: vi.fn(),
}));

// Mock @better-auth/core/oauth2
vi.mock("@better-auth/core/oauth2", () => ({
  createAuthorizationURL: vi.fn(),
  validateAuthorizationCode: vi.fn(),
}));

import {
  createAuthorizationURL,
  validateAuthorizationCode,
} from "@better-auth/core/oauth2";
import { betterFetch } from "@better-fetch/fetch";

const mockedBetterFetch = vi.mocked(betterFetch);
const mockedCreateAuthorizationURL = vi.mocked(createAuthorizationURL);
const mockedValidateAuthorizationCode = vi.mocked(validateAuthorizationCode);

const BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz";
const BOT_ID = "123456789";

describe("buildScopes", () => {
  it("should include openid by default", () => {
    const scopes = buildScopes({});
    expect(scopes).toContain("openid");
  });

  it("should include profile when no custom scopes are provided", () => {
    const scopes = buildScopes({});
    expect(scopes).toContain("profile");
    expect(scopes).toEqual(["openid", "profile"]);
  });

  it("should not include profile when custom scopes are provided", () => {
    const scopes = buildScopes({ scopes: ["email"] });
    expect(scopes).not.toContain("profile");
    expect(scopes).toContain("email");
  });

  it("should add phone scope when requestPhone is true", () => {
    const scopes = buildScopes({ requestPhone: true });
    expect(scopes).toContain("phone");
    expect(scopes).toContain("openid");
    expect(scopes).toContain("profile");
  });

  it("should add telegram:bot_access scope when requestBotAccess is true", () => {
    const scopes = buildScopes({ requestBotAccess: true });
    expect(scopes).toContain("telegram:bot_access");
  });

  it("should combine all scopes correctly", () => {
    const scopes = buildScopes({
      scopes: ["email", "custom_scope"],
      requestPhone: true,
      requestBotAccess: true,
    });

    expect(scopes).toContain("openid");
    expect(scopes).toContain("email");
    expect(scopes).toContain("custom_scope");
    expect(scopes).toContain("phone");
    expect(scopes).toContain("telegram:bot_access");
  });

  it("should not produce duplicate scopes", () => {
    const scopes = buildScopes({
      scopes: ["openid", "profile", "phone"],
      requestPhone: true,
    });

    const uniqueScopes = [...new Set(scopes)];
    expect(scopes.length).toBe(uniqueScopes.length);
  });

  it("should not add phone when requestPhone is false", () => {
    const scopes = buildScopes({ requestPhone: false });
    expect(scopes).not.toContain("phone");
  });

  it("should not add telegram:bot_access when requestBotAccess is false", () => {
    const scopes = buildScopes({ requestBotAccess: false });
    expect(scopes).not.toContain("telegram:bot_access");
  });

  it("should handle empty scopes array", () => {
    const scopes = buildScopes({ scopes: [] });
    expect(scopes).toContain("openid");
    expect(scopes).not.toContain("profile");
  });
});

describe("createTelegramOIDCProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Provider shape", () => {
    it("should return a valid OAuthProvider object", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN);

      expect(provider).toHaveProperty("id");
      expect(provider).toHaveProperty("name");
      expect(provider).toHaveProperty("createAuthorizationURL");
      expect(provider).toHaveProperty("validateAuthorizationCode");
      expect(provider).toHaveProperty("getUserInfo");
      expect(provider).toHaveProperty("verifyIdToken");
      expect(provider).toHaveProperty("options");
    });

    it("should have correct id", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      expect(provider.id).toBe(TELEGRAM_OIDC_PROVIDER_ID);
      expect(provider.id).toBe("telegram-oidc");
    });

    it("should have correct name", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      expect(provider.name).toBe("Telegram");
    });

    it("should have all methods as functions", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN);

      expect(typeof provider.createAuthorizationURL).toBe("function");
      expect(typeof provider.validateAuthorizationCode).toBe("function");
      expect(typeof provider.getUserInfo).toBe("function");
      expect(typeof provider.verifyIdToken).toBe("function");
    });

    it("should set correct options with bot ID as clientId", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      expect(provider.options).toEqual({
        clientId: BOT_ID,
        clientSecret: BOT_TOKEN,
      });
    });
  });

  describe("Bot ID extraction", () => {
    it("should extract bot ID from standard token format", () => {
      const provider = createTelegramOIDCProvider("987654321:XYZabcDEFghiJKL");
      expect(provider.options?.clientId).toBe("987654321");
    });

    it("should use first part before colon as bot ID", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      expect(provider.options?.clientId).toBe("123456789");
    });

    it("should handle token with multiple colons", () => {
      const provider = createTelegramOIDCProvider("111:abc:def");
      expect(provider.options?.clientId).toBe("111");
    });
  });

  describe("createAuthorizationURL", () => {
    it("should call createAuthorizationURL with correct parameters", async () => {
      const mockUrl = new URL("https://oauth.telegram.org/auth?test=1");
      mockedCreateAuthorizationURL.mockResolvedValueOnce(mockUrl);

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.createAuthorizationURL({
        state: "test-state",
        codeVerifier: "test-verifier",
        redirectURI: "https://example.com/callback",
        scopes: undefined,
        display: undefined,
        loginHint: undefined,
      });

      expect(mockedCreateAuthorizationURL).toHaveBeenCalledWith({
        id: TELEGRAM_OIDC_PROVIDER_ID,
        options: {
          clientId: BOT_ID,
          clientSecret: BOT_TOKEN,
        },
        authorizationEndpoint: TELEGRAM_OIDC_AUTH_ENDPOINT,
        scopes: expect.arrayContaining(["openid", "profile"]),
        state: "test-state",
        codeVerifier: "test-verifier",
        redirectURI: "https://example.com/callback",
      });

      expect(result).toBe(mockUrl);
    });

    it("should include additional scopes passed directly", async () => {
      const mockUrl = new URL("https://oauth.telegram.org/auth");
      mockedCreateAuthorizationURL.mockResolvedValueOnce(mockUrl);

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      await provider.createAuthorizationURL({
        state: "state",
        codeVerifier: "verifier",
        redirectURI: "https://example.com/cb",
        scopes: ["extra_scope"],
        display: undefined,
        loginHint: undefined,
      });

      const callArgs = mockedCreateAuthorizationURL.mock.calls[0]![0];
      expect(callArgs.scopes).toContain("extra_scope");
      expect(callArgs.scopes).toContain("openid");
    });

    it("should use custom scopes from options", async () => {
      const mockUrl = new URL("https://oauth.telegram.org/auth");
      mockedCreateAuthorizationURL.mockResolvedValueOnce(mockUrl);

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        requestPhone: true,
        requestBotAccess: true,
      });

      await provider.createAuthorizationURL({
        state: "state",
        codeVerifier: "verifier",
        redirectURI: "https://example.com/cb",
        scopes: undefined,
        display: undefined,
        loginHint: undefined,
      });

      const callArgs = mockedCreateAuthorizationURL.mock.calls[0]![0];
      expect(callArgs.scopes).toContain("phone");
      expect(callArgs.scopes).toContain("telegram:bot_access");
    });
  });

  describe("validateAuthorizationCode", () => {
    it("should call validateAuthorizationCode with correct parameters", async () => {
      const mockTokens = {
        accessToken: "access-token",
        idToken: "id-token",
      };
      mockedValidateAuthorizationCode.mockResolvedValueOnce(mockTokens);

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.validateAuthorizationCode({
        code: "auth-code",
        codeVerifier: "verifier",
        redirectURI: "https://example.com/cb",
      });

      expect(mockedValidateAuthorizationCode).toHaveBeenCalledWith({
        code: "auth-code",
        codeVerifier: "verifier",
        redirectURI: "https://example.com/cb",
        options: {
          clientId: BOT_ID,
          clientSecret: BOT_TOKEN,
        },
        tokenEndpoint: TELEGRAM_OIDC_TOKEN_ENDPOINT,
      });

      expect(result).toBe(mockTokens);
    });
  });

  describe("getUserInfo", () => {
    function createTestJWT(claims: Partial<TelegramOIDCClaims>): string {
      const header = Buffer.from(
        JSON.stringify({ alg: "RS256", typ: "JWT" })
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          sub: "12345",
          name: "John Doe",
          picture: "https://example.com/photo.jpg",
          preferred_username: "johndoe",
          iss: TELEGRAM_OIDC_ISSUER,
          aud: BOT_ID,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...claims,
        })
      ).toString("base64url");
      const signature = Buffer.from("fake-signature").toString("base64url");
      return `${header}.${payload}.${signature}`;
    }

    it("should return null when no idToken is provided", async () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.getUserInfo({
        idToken: undefined,
      });

      expect(result).toBeNull();
    });

    it("should decode JWT and map claims to user info", async () => {
      const idToken = createTestJWT({
        sub: "99999",
        name: "Alice Smith",
        picture: "https://example.com/alice.jpg",
        preferred_username: "alice",
      });

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.getUserInfo({ idToken });

      expect(result).not.toBeNull();
      expect(result!.user.id).toBe("99999");
      expect(result!.user.name).toBe("Alice Smith");
      expect(result!.user.image).toBe("https://example.com/alice.jpg");
      expect(result!.user.emailVerified).toBe(false);
      expect(result!.user.email).toBeUndefined();
    });

    it("should return claims as data", async () => {
      const idToken = createTestJWT({
        sub: "12345",
        preferred_username: "johndoe",
        phone_number: "+1234567890",
      });

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.getUserInfo({ idToken });

      expect(result!.data.sub).toBe("12345");
      expect(result!.data.preferred_username).toBe("johndoe");
      expect(result!.data.phone_number).toBe("+1234567890");
    });

    it("should handle missing optional claims", async () => {
      const idToken = createTestJWT({
        sub: "12345",
        name: undefined,
        picture: undefined,
        preferred_username: undefined,
      });

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.getUserInfo({ idToken });

      expect(result).not.toBeNull();
      expect(result!.user.id).toBe("12345");
      expect(result!.user.name).toBeUndefined();
      expect(result!.user.image).toBeUndefined();
    });

    it("should always set emailVerified to false", async () => {
      const idToken = createTestJWT({ sub: "12345" });

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.getUserInfo({ idToken });

      expect(result!.user.emailVerified).toBe(false);
    });

    it("should always set email to undefined", async () => {
      const idToken = createTestJWT({ sub: "12345" });

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.getUserInfo({ idToken });

      expect(result!.user.email).toBeUndefined();
    });

    it("should use mapOIDCProfileToUser when provided", async () => {
      const idToken = createTestJWT({
        sub: "12345",
        name: "Original Name",
        preferred_username: "original",
      });

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        mapOIDCProfileToUser: (claims) => ({
          name: `Custom: ${claims.name}`,
          email: "custom@example.com",
          image: "https://custom.com/photo.jpg",
        }),
      });

      const result = await provider.getUserInfo({ idToken });

      expect(result!.user.name).toBe("Custom: Original Name");
      expect(result!.user.email).toBe("custom@example.com");
      expect(result!.user.image).toBe("https://custom.com/photo.jpg");
    });

    it("should override default fields with mapOIDCProfileToUser result", async () => {
      const idToken = createTestJWT({
        sub: "12345",
        name: "Original",
      });

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        mapOIDCProfileToUser: () => ({
          name: "Overridden",
        }),
      });

      const result = await provider.getUserInfo({ idToken });

      expect(result!.user.name).toBe("Overridden");
      expect(result!.user.id).toBe("12345");
    });

    it("should still include standard fields when mapOIDCProfileToUser is provided", async () => {
      const idToken = createTestJWT({
        sub: "12345",
        name: "Alice",
        picture: "https://example.com/pic.jpg",
      });

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        mapOIDCProfileToUser: () => ({
          name: "Custom Alice",
        }),
      });

      const result = await provider.getUserInfo({ idToken });

      // mapOIDCProfileToUser overrides spread last
      expect(result!.user.id).toBe("12345");
      expect(result!.user.emailVerified).toBe(false);
    });
  });

  describe("verifyIdToken", () => {
    let rsaKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;
    let jwk: any;

    beforeEach(async () => {
      rsaKeyPair = await generateKeyPair("RS256");
      const exportedJwk = await exportJWK(rsaKeyPair.publicKey);
      jwk = {
        ...exportedJwk,
        kid: "test-kid-1",
        alg: "RS256",
        use: "sig",
      };
    });

    async function createSignedJWT(
      claims: Record<string, any>,
      kid = "test-kid-1"
    ): Promise<string> {
      return await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuedAt()
        .setExpirationTime("1h")
        .setIssuer(TELEGRAM_OIDC_ISSUER)
        .setAudience(BOT_ID)
        .sign(rsaKeyPair.privateKey);
    }

    it("should verify a valid JWT token", async () => {
      mockedBetterFetch.mockResolvedValueOnce({
        data: { keys: [jwk] },
      } as any);

      const token = await createSignedJWT({
        sub: "12345",
        name: "Test User",
      });

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.verifyIdToken!(token);

      expect(result).toBe(true);
      expect(mockedBetterFetch).toHaveBeenCalledWith(TELEGRAM_OIDC_JWKS_URI);
    });

    it("should return false when JWT header has no kid", async () => {
      // Create a JWT without kid in header
      const token = new SignJWT({ sub: "12345" })
        .setProtectedHeader({ alg: "RS256" }) // no kid
        .setIssuedAt()
        .setExpirationTime("1h")
        .setIssuer(TELEGRAM_OIDC_ISSUER)
        .setAudience(BOT_ID);

      const signedToken = await token.sign(rsaKeyPair.privateKey);

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      const result = await provider.verifyIdToken!(signedToken);

      expect(result).toBe(false);
    });

    it("should throw when JWKS fetch fails", async () => {
      mockedBetterFetch.mockResolvedValueOnce({
        data: null,
      } as any);

      const token = await createSignedJWT({ sub: "12345" });

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      await expect(provider.verifyIdToken!(token)).rejects.toThrow(
        "Failed to fetch Telegram JWKS"
      );
    });

    it("should throw when kid is not found in JWKS", async () => {
      mockedBetterFetch.mockResolvedValueOnce({
        data: {
          keys: [{ ...jwk, kid: "different-kid" }],
        },
      } as any);

      const token = await createSignedJWT({ sub: "12345" });

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      await expect(provider.verifyIdToken!(token)).rejects.toThrow(
        "JWK with kid test-kid-1 not found"
      );
    });

    it("should reject a token with wrong issuer", async () => {
      mockedBetterFetch.mockResolvedValueOnce({
        data: { keys: [jwk] },
      } as any);

      const token = new SignJWT({ sub: "12345" })
        .setProtectedHeader({ alg: "RS256", kid: "test-kid-1" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .setIssuer("https://wrong-issuer.com")
        .setAudience(BOT_ID);

      const signedToken = await token.sign(rsaKeyPair.privateKey);

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      await expect(provider.verifyIdToken!(signedToken)).rejects.toThrow();
    });

    it("should reject a token with wrong audience", async () => {
      mockedBetterFetch.mockResolvedValueOnce({
        data: { keys: [jwk] },
      } as any);

      const token = new SignJWT({ sub: "12345" })
        .setProtectedHeader({ alg: "RS256", kid: "test-kid-1" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .setIssuer(TELEGRAM_OIDC_ISSUER)
        .setAudience("wrong-audience");

      const signedToken = await token.sign(rsaKeyPair.privateKey);

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      await expect(provider.verifyIdToken!(signedToken)).rejects.toThrow();
    });

    it("should reject an expired token", async () => {
      mockedBetterFetch.mockResolvedValueOnce({
        data: { keys: [jwk] },
      } as any);

      const token = new SignJWT({ sub: "12345" })
        .setProtectedHeader({ alg: "RS256", kid: "test-kid-1" })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .setIssuer(TELEGRAM_OIDC_ISSUER)
        .setAudience(BOT_ID);

      const signedToken = await token.sign(rsaKeyPair.privateKey);

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      await expect(provider.verifyIdToken!(signedToken)).rejects.toThrow();
    });

    it("should reject a token signed with a different key", async () => {
      mockedBetterFetch.mockResolvedValueOnce({
        data: { keys: [jwk] },
      } as any);

      // Generate a different key pair
      const otherKeyPair = await generateKeyPair("RS256");

      const token = new SignJWT({ sub: "12345" })
        .setProtectedHeader({ alg: "RS256", kid: "test-kid-1" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .setIssuer(TELEGRAM_OIDC_ISSUER)
        .setAudience(BOT_ID);

      const signedToken = await token.sign(otherKeyPair.privateKey);

      const provider = createTelegramOIDCProvider(BOT_TOKEN);
      await expect(provider.verifyIdToken!(signedToken)).rejects.toThrow();
    });
  });
});

describe("Plugin integration", () => {
  describe("init hook with OIDC", () => {
    it("should include init hook when oidc.enabled is true", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true },
      });

      expect(plugin).toHaveProperty("init");
      expect(typeof plugin.init).toBe("function");
    });

    it("should NOT include init hook when oidc is not configured", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
      });

      expect(plugin).not.toHaveProperty("init");
    });

    it("should NOT include init hook when oidc.enabled is false", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: false },
      });

      expect(plugin).not.toHaveProperty("init");
    });

    it("should return socialProviders from init hook", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true },
      });

      const mockCtx = {
        socialProviders: [],
        getPlugin: () => undefined,
        hasPlugin: () => false,
      } as any;
      const result = plugin.init!(mockCtx);

      expect(result.context!.socialProviders).toHaveLength(1);
      expect(result.context!.socialProviders![0]!.id).toBe(
        TELEGRAM_OIDC_PROVIDER_ID
      );
      expect(result.context!.socialProviders![0]!.name).toBe("Telegram");
    });

    it("should preserve existing social providers via concat", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true },
      });

      const existingProvider = {
        id: "google",
        name: "Google",
      };
      const mockCtx = {
        socialProviders: [existingProvider],
        getPlugin: () => undefined,
        hasPlugin: () => false,
      } as any;
      const result = plugin.init!(mockCtx);

      expect(result.context!.socialProviders).toHaveLength(2);
      expect(result.context!.socialProviders![0]!.id).toBe(
        TELEGRAM_OIDC_PROVIDER_ID
      );
      expect(result.context!.socialProviders![1]!).toBe(existingProvider);
    });

    it("should pass OIDC options to the provider", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: {
          enabled: true,
          requestPhone: true,
          requestBotAccess: true,
        },
      });

      const mockCtx = {
        socialProviders: [],
        getPlugin: () => undefined,
        hasPlugin: () => false,
      } as any;
      const result = plugin.init!(mockCtx);
      const provider = result.context!.socialProviders![0];

      expect(provider!.options?.clientId).toBe(BOT_ID);
      expect(provider!.options?.clientSecret).toBe(BOT_TOKEN);
    });
  });

  describe("Config endpoint oidcEnabled", () => {
    it("should have getTelegramConfig endpoint", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true },
      });

      expect(plugin.endpoints).toHaveProperty("getTelegramConfig");
    });

    it("should include telegramPhoneNumber in schema", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true },
      });

      expect(plugin.schema.user.fields).toHaveProperty("telegramPhoneNumber");
      expect(plugin.schema.user.fields.telegramPhoneNumber).toEqual({
        type: "string",
        required: false,
        unique: false,
        input: false,
      });
    });
  });
});

describe("Client signInWithTelegramOIDC", () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should have signInWithTelegramOIDC action", async () => {
    const { telegramClient } = await import("./client");
    const client = telegramClient();
    const actions = client.getActions(mockFetch);

    expect(actions).toHaveProperty("signInWithTelegramOIDC");
    expect(typeof actions.signInWithTelegramOIDC).toBe("function");
  });

  it("should call /sign-in/social with provider telegram-oidc", async () => {
    mockFetch.mockResolvedValueOnce({ data: {} });

    const { telegramClient } = await import("./client");
    const client = telegramClient();
    const actions = client.getActions(mockFetch);

    await actions.signInWithTelegramOIDC();

    expect(mockFetch).toHaveBeenCalledWith("/sign-in/social", {
      method: "POST",
      body: {
        provider: "telegram-oidc",
        callbackURL: undefined,
        errorCallbackURL: undefined,
      },
    });
  });

  it("should pass callbackURL correctly", async () => {
    mockFetch.mockResolvedValueOnce({ data: {} });

    const { telegramClient } = await import("./client");
    const client = telegramClient();
    const actions = client.getActions(mockFetch);

    await actions.signInWithTelegramOIDC({
      callbackURL: "/dashboard",
    });

    expect(mockFetch).toHaveBeenCalledWith("/sign-in/social", {
      method: "POST",
      body: {
        provider: "telegram-oidc",
        callbackURL: "/dashboard",
        errorCallbackURL: undefined,
      },
    });
  });

  it("should pass errorCallbackURL correctly", async () => {
    mockFetch.mockResolvedValueOnce({ data: {} });

    const { telegramClient } = await import("./client");
    const client = telegramClient();
    const actions = client.getActions(mockFetch);

    await actions.signInWithTelegramOIDC({
      callbackURL: "/dashboard",
      errorCallbackURL: "/error",
    });

    expect(mockFetch).toHaveBeenCalledWith("/sign-in/social", {
      method: "POST",
      body: {
        provider: "telegram-oidc",
        callbackURL: "/dashboard",
        errorCallbackURL: "/error",
      },
    });
  });

  it("should pass fetchOptions correctly", async () => {
    mockFetch.mockResolvedValueOnce({ data: {} });

    const { telegramClient } = await import("./client");
    const client = telegramClient();
    const actions = client.getActions(mockFetch);

    await actions.signInWithTelegramOIDC(
      { callbackURL: "/dashboard" },
      { headers: { "X-Custom": "value" } }
    );

    expect(mockFetch).toHaveBeenCalledWith("/sign-in/social", {
      method: "POST",
      body: {
        provider: "telegram-oidc",
        callbackURL: "/dashboard",
        errorCallbackURL: undefined,
      },
      headers: { "X-Custom": "value" },
    });
  });

  it("should return response from fetch", async () => {
    const expectedResponse = {
      data: { url: "https://oauth.telegram.org/auth?..." },
    };
    mockFetch.mockResolvedValueOnce(expectedResponse);

    const { telegramClient } = await import("./client");
    const client = telegramClient();
    const actions = client.getActions(mockFetch);

    const result = await actions.signInWithTelegramOIDC({
      callbackURL: "/dashboard",
    });

    expect(result).toEqual(expectedResponse);
  });

  it("should handle errors from fetch", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { telegramClient } = await import("./client");
    const client = telegramClient();
    const actions = client.getActions(mockFetch);

    await expect(
      actions.signInWithTelegramOIDC({ callbackURL: "/dashboard" })
    ).rejects.toThrow("Network error");
  });

  it("should work without options parameter", async () => {
    mockFetch.mockResolvedValueOnce({ data: {} });

    const { telegramClient } = await import("./client");
    const client = telegramClient();
    const actions = client.getActions(mockFetch);

    await actions.signInWithTelegramOIDC();

    expect(mockFetch).toHaveBeenCalledWith("/sign-in/social", {
      method: "POST",
      body: {
        provider: "telegram-oidc",
        callbackURL: undefined,
        errorCallbackURL: undefined,
      },
    });
  });
});

describe("Constants", () => {
  it("should export correct OIDC constants", () => {
    expect(TELEGRAM_OIDC_PROVIDER_ID).toBe("telegram-oidc");
    expect(TELEGRAM_OIDC_ISSUER).toBe("https://oauth.telegram.org");
    expect(TELEGRAM_OIDC_AUTH_ENDPOINT).toBe("https://oauth.telegram.org/auth");
    expect(TELEGRAM_OIDC_TOKEN_ENDPOINT).toBe(
      "https://oauth.telegram.org/token"
    );
    expect(TELEGRAM_OIDC_JWKS_URI).toBe(
      "https://oauth.telegram.org/.well-known/jwks.json"
    );
  });
});
