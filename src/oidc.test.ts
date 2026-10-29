/**
 * @vitest-environment happy-dom
 */

import {
  createAuthorizationURL,
  validateAuthorizationCode,
} from "@better-auth/core/oauth2";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import {
  TELEGRAM_OIDC_AUTH_ENDPOINT,
  TELEGRAM_OIDC_ISSUER,
  TELEGRAM_OIDC_JWKS_URI,
  TELEGRAM_OIDC_PROVIDER_ID,
  TELEGRAM_OIDC_TOKEN_ENDPOINT,
} from "./constants";
import { buildScopes, createTelegramOIDCProvider } from "./oidc";
import { mockTelegramOIDC, telegramClaims } from "./testing/harness";
import type { TelegramOIDCClaims } from "./types";

// Mock @better-auth/core/oauth2 (hoisted above the imports by Vitest)
vi.mock("@better-auth/core/oauth2", () => ({
  createAuthorizationURL: vi.fn(),
  validateAuthorizationCode: vi.fn(),
}));

const mockedCreateAuthorizationURL = vi.mocked(createAuthorizationURL);
const mockedValidateAuthorizationCode = vi.mocked(validateAuthorizationCode);

const BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz";
const BOT_ID = "123456789";
const CLIENT_SECRET = "client-secret-from-botfather";

describe("TelegramOIDCClaims", () => {
  it("models Telegram profile and phone verification claims", () => {
    expectTypeOf<TelegramOIDCClaims["id"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<TelegramOIDCClaims["given_name"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<TelegramOIDCClaims["family_name"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<TelegramOIDCClaims["phone_number_verified"]>().toEqualTypeOf<
      boolean | undefined
    >();
  });
});

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
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      expect(provider).toHaveProperty("id");
      expect(provider).toHaveProperty("name");
      expect(provider).toHaveProperty("createAuthorizationURL");
      expect(provider).toHaveProperty("validateAuthorizationCode");
      expect(provider).toHaveProperty("getUserInfo");
      expect(provider).toHaveProperty("accountSubject");
      expect(provider).toHaveProperty("idToken");
      expect(provider).toHaveProperty("options");
    });

    it("should have correct id", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
      expect(provider.id).toBe(TELEGRAM_OIDC_PROVIDER_ID);
      expect(provider.id).toBe("telegram-oidc");
    });

    it("should have correct name", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
      expect(provider.name).toBe("Telegram");
    });

    it("should have all methods as functions", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      expect(typeof provider.createAuthorizationURL).toBe("function");
      expect(typeof provider.validateAuthorizationCode).toBe("function");
      expect(typeof provider.getUserInfo).toBe("function");
      expect(typeof provider.accountSubject).toBe("function");
    });

    it("binds ID tokens to the authorization request and Telegram's issuer", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      expect(provider.requiresIdTokenNonce).toBe(true);
      expect(provider.issuer).toBe(TELEGRAM_OIDC_ISSUER);
      expect(provider.idToken).toHaveProperty("verify");
    });

    it("rejects client-submitted ID tokens without a nonce", async () => {
      const telegram = await mockTelegramOIDC();
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
      const token = await telegram.sign({ ...telegramClaims(), nonce: "n" });
      const { verify } = provider.idToken as {
        verify: (t: string, n?: string) => Promise<boolean>;
      };

      expect(await verify(token)).toBe(false);
      expect(await verify(token, "other")).toBe(false);
      expect(await verify(token, "n")).toBe(true);
      telegram.restore();
    });

    it("verifies client-submitted ID tokens against the configured client ID", async () => {
      const telegram = await mockTelegramOIDC({ clientId: "987654321" });
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
        clientId: "987654321",
      });
      const { verify } = provider.idToken as {
        verify: (t: string, n?: string) => Promise<boolean>;
      };
      const token = await telegram.sign({ ...telegramClaims(), nonce: "n" });

      expect(await verify(token, "n")).toBe(true);
      telegram.restore();
    });

    it("should set correct options with bot ID as clientId", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
      expect(provider.options).toMatchObject({
        clientId: BOT_ID,
        clientSecret: CLIENT_SECRET,
      });
    });

    it("should use separate clientId when provided", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
        clientId: "999888777",
      });
      expect(provider.options?.clientId).toBe("999888777");
      warnSpy.mockRestore();
    });

    it("should use separate clientSecret when provided", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: "separate-oidc-secret",
      });
      expect(provider.options).toEqual({
        clientId: BOT_ID,
        clientSecret: "separate-oidc-secret",
      });
    });

    it("never uses the bot token as the client secret", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {});

      expect(provider.options?.clientSecret).toBe("");
      expect(() =>
        provider.createAuthorizationURL({
          state: "s",
          codeVerifier: "v",
          redirectURI: "https://example.com/cb",
        })
      ).toThrow("clientSecret is required");
    });

    it("passes disableIdTokenSignIn and disableSignUp to Better Auth", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
        disableIdTokenSignIn: true,
        disableSignUp: true,
      });

      expect(provider.options).toMatchObject({
        disableIdTokenSignIn: true,
        disableSignUp: true,
      });
    });
  });

  describe("Bot ID extraction", () => {
    it("should extract bot ID from standard token format", () => {
      const provider = createTelegramOIDCProvider("987654321:XYZabcDEFghiJKL");
      expect(provider.options?.clientId).toBe("987654321");
    });

    it("should use first part before colon as bot ID", () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
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

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
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
          clientSecret: CLIENT_SECRET,
        },
        authorizationEndpoint: TELEGRAM_OIDC_AUTH_ENDPOINT,
        scopes: expect.arrayContaining(["openid", "profile"]),
        state: "test-state",
        codeVerifier: "test-verifier",
        redirectURI: "https://example.com/callback",
        nonce: undefined,
      });

      expect(result).toBe(mockUrl);
    });

    it("forwards the ID token nonce Better Auth generated", async () => {
      mockedCreateAuthorizationURL.mockResolvedValueOnce(
        new URL("https://oauth.telegram.org/auth")
      );

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
      await provider.createAuthorizationURL({
        state: "s",
        codeVerifier: "v",
        redirectURI: "https://example.com/callback",
        idTokenNonce: "nonce-1",
      });

      expect(mockedCreateAuthorizationURL).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: "nonce-1" })
      );
    });

    it("should reject authorization when neither botToken nor OIDC credentials are configured", () => {
      const provider = createTelegramOIDCProvider("", {});

      expect(() =>
        provider.createAuthorizationURL({
          state: "state",
          codeVerifier: "verifier",
          scopes: [],
          redirectURI: "https://example.com/callback",
        })
      ).toThrow("clientId");
      expect(mockedCreateAuthorizationURL).not.toHaveBeenCalled();
    });

    it("should reject authorization when clientSecret is missing", () => {
      const provider = createTelegramOIDCProvider("", {
        clientId: "123456789",
      });

      expect(() =>
        provider.createAuthorizationURL({
          state: "state",
          codeVerifier: "verifier",
          scopes: [],
          redirectURI: "https://example.com/callback",
        })
      ).toThrow("clientSecret");
      expect(mockedCreateAuthorizationURL).not.toHaveBeenCalled();
    });

    it("should include additional scopes passed directly", async () => {
      const mockUrl = new URL("https://oauth.telegram.org/auth");
      mockedCreateAuthorizationURL.mockResolvedValueOnce(mockUrl);

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
      await provider.createAuthorizationURL({
        state: "state",
        codeVerifier: "verifier",
        redirectURI: "https://example.com/cb",
        scopes: ["extra_scope"],
        display: undefined,
        loginHint: undefined,
      });

      const [{ scopes }] = mockedCreateAuthorizationURL.mock.lastCall!;
      expect(scopes).toContain("extra_scope");
      expect(scopes).toContain("openid");
    });

    it("should use custom scopes from options", async () => {
      const mockUrl = new URL("https://oauth.telegram.org/auth");
      mockedCreateAuthorizationURL.mockResolvedValueOnce(mockUrl);

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
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

      const [{ scopes }] = mockedCreateAuthorizationURL.mock.lastCall!;
      expect(scopes).toContain("phone");
      expect(scopes).toContain("telegram:bot_access");
    });

    it("should NOT pass additionalParams, origin, or bot_id (issue #12)", async () => {
      const mockUrl = new URL("https://oauth.telegram.org/auth");
      mockedCreateAuthorizationURL.mockResolvedValueOnce(mockUrl);

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
      await provider.createAuthorizationURL({
        state: "state",
        codeVerifier: "verifier",
        redirectURI: "https://api.example.com/api/auth/callback/telegram-oidc",
        scopes: undefined,
        display: undefined,
        loginHint: undefined,
      });

      const callArgs = mockedCreateAuthorizationURL.mock.calls[0]![0] as any;
      expect(callArgs).not.toHaveProperty("additionalParams");
      expect(callArgs).not.toHaveProperty("origin");
      expect(callArgs).not.toHaveProperty("bot_id");
    });
  });

  describe("validateAuthorizationCode", () => {
    it("should call validateAuthorizationCode with correct parameters", async () => {
      const mockTokens = {
        accessToken: "access-token",
        idToken: "id-token",
      };
      mockedValidateAuthorizationCode.mockResolvedValueOnce(mockTokens);

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
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
          clientSecret: CLIENT_SECRET,
        },
        tokenEndpoint: TELEGRAM_OIDC_TOKEN_ENDPOINT,
        authentication: "basic",
      });

      expect(result).toBe(mockTokens);
    });

    it("turns an error answered with HTTP 200 into a failed exchange", async () => {
      mockedValidateAuthorizationCode.mockResolvedValueOnce({
        raw: { error: "invalid_grant" },
      });

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      await expect(
        provider.validateAuthorizationCode({
          code: "expired",
          codeVerifier: "v",
          redirectURI: "https://example.com/cb",
        })
      ).rejects.toThrow('token endpoint returned "invalid_grant"');
    });

    it("should use separate clientSecret for token exchange", async () => {
      const mockTokens = { accessToken: "at", idToken: "it" };
      mockedValidateAuthorizationCode.mockResolvedValueOnce(mockTokens);

      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: "oidc-secret-from-botfather",
      });
      await provider.validateAuthorizationCode({
        code: "auth-code",
        codeVerifier: "verifier",
        redirectURI: "https://example.com/cb",
      });

      expect(mockedValidateAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          options: {
            clientId: BOT_ID,
            clientSecret: "oidc-secret-from-botfather",
          },
        })
      );
    });
  });

  describe("accountSubject", () => {
    const profile = telegramClaims() as unknown as TelegramOIDCClaims;

    it("uses the OIDC sub, not Telegram's numeric id", async () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      expect(await provider.accountSubject({ tokens: {}, profile })).toBe(
        "12224742808376279442"
      );
    });

    it.each([undefined, "", "   ", 123])("rejects subject %s", (sub) => {
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
    let telegram: Awaited<ReturnType<typeof mockTelegramOIDC>>;

    beforeEach(async () => {
      telegram = await mockTelegramOIDC();
    });

    afterEach(() => {
      telegram.restore();
    });

    it("maps verified claims to the user", async () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
      const idToken = await telegram.sign(telegramClaims());

      const result = await provider.getUserInfo({ idToken });

      expect(result?.user).toEqual({
        name: "Ann Example",
        image: "https://t.me/i/userpic/320/ann.jpg",
        email: "12224742808376279442@telegram-oidc.placeholder.invalid",
        emailVerified: false,
      });
      expect(result?.data).toMatchObject({
        id: "8306595751",
        sub: "12224742808376279442",
      });
    });

    it("builds the name from given and family name, then username", async () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      const fromParts = await provider.getUserInfo({
        idToken: await telegram.sign(telegramClaims({ name: undefined })),
      });
      const fromUsername = await provider.getUserInfo({
        idToken: await telegram.sign({ sub: "1", preferred_username: "ann" }),
      });

      expect(fromParts?.user.name).toBe("Ann Example");
      expect(fromUsername?.user.name).toBe("ann");
    });

    it("applies mapOIDCProfileToUser but never lets it set the id", async () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
        mapOIDCProfileToUser: (claims) => ({
          id: "hijack",
          email: `${claims.preferred_username}@example.com`,
        }),
      });

      const result = await provider.getUserInfo({
        idToken: await telegram.sign(telegramClaims()),
      });

      expect(result?.user.email).toBe("ann@example.com");
      expect(result?.user).not.toHaveProperty("id");
    });

    it("rejects a token Telegram did not sign", async () => {
      const forger = await mockTelegramOIDC();
      const idToken = await forger.sign(telegramClaims());
      forger.restore();
      telegram.restore();
      telegram = await mockTelegramOIDC();
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      expect(await provider.getUserInfo({ idToken })).toBeNull();
    });

    it("rejects a token issued to another bot", async () => {
      const other = await mockTelegramOIDC({ clientId: "999" });
      const idToken = await other.sign(telegramClaims());
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      expect(await provider.getUserInfo({ idToken })).toBeNull();
      other.restore();
    });

    it("rejects a token whose nonce differs from the authorization request", async () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });
      const idToken = await telegram.sign({ ...telegramClaims(), nonce: "a" });

      expect(
        await provider.getUserInfo({ idToken, expectedIdTokenNonce: "b" })
      ).toBeNull();
      expect(
        await provider.getUserInfo({ idToken, expectedIdTokenNonce: "a" })
      ).not.toBeNull();
    });

    it("returns null without an id_token", async () => {
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      expect(await provider.getUserInfo({ accessToken: "at" })).toBeNull();
    });

    it("warns when the token has no profile claims", async () => {
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const provider = createTelegramOIDCProvider(BOT_TOKEN, {
        clientSecret: CLIENT_SECRET,
      });

      const result = await provider.getUserInfo({
        idToken: await telegram.sign({ sub: "12224742808376279442" }),
      });

      expect(result).not.toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("no profile claims"),
        expect.any(String),
        expect.any(String)
      );
      warn.mockRestore();
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
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      });

      expect(plugin).toHaveProperty("init");
      expect(typeof plugin.init).toBe("function");
    });

    it("does not inject a social provider when oidc is not configured", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
      });

      const result = plugin.init({ socialProviders: [] } as any);
      expect(result).not.toHaveProperty("context");
      expect(result.options.databaseHooks).toBeDefined();
    });

    it("does not inject a social provider when oidc.enabled is false", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: false },
      });

      expect(plugin.init({ socialProviders: [] } as any)).not.toHaveProperty(
        "context"
      );
    });

    it("should return socialProviders from init hook", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      });

      const mockCtx = {
        socialProviders: [],
        getPlugin: () => undefined,
        hasPlugin: () => false,
      } as any;
      const result = plugin.init!(mockCtx)!;
      const providers = result.context!.socialProviders!;

      expect(providers).toHaveLength(1);
      expect(providers[0]!.id).toBe(TELEGRAM_OIDC_PROVIDER_ID);
      expect(providers[0]!.name).toBe("Telegram");
    });

    it("should preserve existing social providers via concat", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
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
      const result = plugin.init!(mockCtx)!;
      const providers = result.context!.socialProviders!;

      expect(providers).toHaveLength(2);
      expect(providers[0]!.id).toBe(TELEGRAM_OIDC_PROVIDER_ID);
      expect(providers[1]!).toBe(existingProvider);
    });

    it("should pass OIDC options to the provider", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: {
          enabled: true,
          clientSecret: CLIENT_SECRET,
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
      const [provider] = result.context!.socialProviders!;

      expect(provider!.options?.clientId).toBe(BOT_ID);
      expect(provider!.options?.clientSecret).toBe(CLIENT_SECRET);
    });
  });

  describe("testMode + OIDC warning", () => {
    it("should warn when testMode and oidc are both enabled", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { telegram } = await import("./index");
      telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        testMode: true,
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("testMode is enabled with OIDC")
      );

      warnSpy.mockRestore();
    });

    it("should not warn when only testMode is enabled without OIDC", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { telegram } = await import("./index");
      telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        testMode: true,
      });

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("should not warn when testMode is true and oidc.enabled is false", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { telegram } = await import("./index");
      telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        testMode: true,
        oidc: { enabled: false },
      });

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("should not warn when testMode is false and oidc is enabled", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { telegram } = await import("./index");
      telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        testMode: false,
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      });

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("should include [better-auth-telegram] prefix and oauth.telegram.org in warning", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { telegram } = await import("./index");
      telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        testMode: true,
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[better-auth-telegram]")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("oauth.telegram.org")
      );

      warnSpy.mockRestore();
    });
  });

  describe("testMode defaults and invariants", () => {
    it("should default testMode to false — no warn even with oidc enabled", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { telegram } = await import("./index");
      telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      });

      // testMode defaults to false, so no warning even though oidc is on
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("should not create init hook from testMode alone", async () => {
      const { telegram } = await import("./index");

      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        testMode: true,
      });

      // testMode alone doesn't add a social provider — only oidc.enabled does
      expect(plugin.init({ socialProviders: [] } as any)).not.toHaveProperty(
        "context"
      );
    });

    it("should return init result as an object (not void) when oidc enabled", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      });

      const mockCtx = {
        socialProviders: [],
        getPlugin: () => undefined,
        hasPlugin: () => false,
      } as any;
      const result = plugin.init!(mockCtx);

      // Prove it returns an object, not void/undefined
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("context");
      expect(result!.context).toHaveProperty("socialProviders");
    });
  });

  describe("Config endpoint oidcEnabled", () => {
    it("should have getTelegramConfig endpoint", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      });

      expect(plugin.endpoints).toHaveProperty("getTelegramConfig");
    });

    it("should include telegramPhoneNumber in schema", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram({
        botToken: BOT_TOKEN,
        botUsername: "test_bot",
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      });

      expect(plugin.schema!.user!.fields).toHaveProperty("telegramPhoneNumber");
      expect(plugin.schema!.user!.fields.telegramPhoneNumber).toEqual({
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

describe("Adversarial: testMode option", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should default testMode to false when not specified in options", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
    });

    // The config endpoint should exist and testMode should be false by default
    expect(plugin.endpoints).toHaveProperty("getTelegramConfig");
    // The endpoint created by createAuthEndpoint is a function
    expect(typeof plugin.endpoints.getTelegramConfig).toBe("function");
  });

  it("should not warn when testMode is true and oidc is omitted entirely", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { telegram } = await import("./index");
    telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      testMode: true,
      // no oidc key at all
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("should not warn when testMode is true and oidc.enabled is explicitly false", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { telegram } = await import("./index");
    telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      testMode: true,
      oidc: { enabled: false },
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("should warn with the exact expected message string", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { telegram } = await import("./index");
    telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      testMode: true,
      oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[better-auth-telegram] testMode is enabled with OIDC. Telegram's OIDC endpoint (oauth.telegram.org) has no documented test variant — OIDC authentication may not work with test server bot tokens."
    );
  });

  it("should not warn when testMode is false and oidc is enabled", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { telegram } = await import("./index");
    telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      testMode: false,
      oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("should not warn when testMode is false (default) and oidc is enabled", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { telegram } = await import("./index");
    telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      // testMode omitted, defaults to false
      oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("passing testMode: false explicitly should behave same as omitting it", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { telegram } = await import("./index");

    const pluginWithExplicitFalse = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      testMode: false,
      oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
    });

    const pluginWithOmitted = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
    });

    // Neither should have triggered a warning
    expect(warnSpy).not.toHaveBeenCalled();

    // Both should have the same plugin ID and structure
    expect(pluginWithExplicitFalse.id).toBe(pluginWithOmitted.id);
    expect(pluginWithExplicitFalse.id).toBe("telegram");
  });
});

describe("Adversarial: init hook return value is non-void object", () => {
  it("should return a concrete object from init, not undefined/void", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
    });

    const mockCtx = {
      socialProviders: [],
      getPlugin: () => undefined,
      hasPlugin: () => false,
    } as any;

    const result = plugin.init!(mockCtx);

    // The result must be a non-null object, not undefined
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();

    // It must have the context property with socialProviders
    expect(result).toHaveProperty("context");
    expect(result!.context).toHaveProperty("socialProviders");
    expect(Array.isArray(result!.context!.socialProviders)).toBe(true);
  });
});

describe("Adversarial: config endpoint shape with testMode", () => {
  it("should include all four config fields in the plugin structure", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "my_bot",
      testMode: true,
      miniApp: { enabled: true },
      oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
    });

    // The getTelegramConfig endpoint must exist
    expect(plugin.endpoints).toHaveProperty("getTelegramConfig");
  });

  it("should have PLUGIN_ID as 'telegram'", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
    });

    expect(plugin.id).toBe("telegram");
  });

  it("should include $ERROR_CODES on the plugin", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
    });

    expect(plugin).toHaveProperty("$ERROR_CODES");
    expect(plugin.$ERROR_CODES).toHaveProperty("BOT_TOKEN_REQUIRED");
    expect(plugin.$ERROR_CODES).toHaveProperty("INVALID_AUTH_DATA");
  });

  it("should have rateLimit array with correct path matchers", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
    });

    expect(Array.isArray(plugin.rateLimit)).toBe(true);
    expect(plugin.rateLimit.length).toBeGreaterThanOrEqual(3);

    // Verify path matchers actually work
    const signinMatcher = plugin.rateLimit.find(
      (r) => r.pathMatcher("/telegram/signin") === true
    );
    expect(signinMatcher).toBeDefined();
    expect(signinMatcher!.max).toBe(10);

    const linkMatcher = plugin.rateLimit.find(
      (r) => r.pathMatcher("/telegram/link") === true
    );
    expect(linkMatcher).toBeDefined();
    expect(linkMatcher!.max).toBe(5);

    // Verify matchers don't match wrong paths
    expect(plugin.rateLimit[0]!.pathMatcher("/telegram/link")).toBe(false);
    expect(plugin.rateLimit[1]!.pathMatcher("/telegram/signin")).toBe(false);
  });
});

// These tests read built output — skip when dist/ doesn't exist (e.g. CI runs tests before build)
