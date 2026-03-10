/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock better-auth/api — extract the raw handler from createAuthEndpoint
vi.mock("better-auth/api", () => {
  class MockAPIError extends Error {
    status: string;
    constructor(status: string, opts: { message: string }) {
      super(opts.message);
      this.status = status;
    }
    static from(status: string, error: { code: string; message: string }) {
      return new MockAPIError(status, { message: error.message });
    }
  }

  return {
    createAuthEndpoint: vi.fn(
      (_path: string, _options: any, handler: any) => handler
    ),
    sessionMiddleware: {},
    APIError: MockAPIError,
  };
});

vi.mock("better-auth/cookies", () => ({
  setSessionCookie: vi.fn(),
}));

vi.mock("./verify", () => ({
  verifyTelegramAuth: vi.fn(),
  verifyMiniAppInitData: vi.fn(),
  validateTelegramAuthData: vi.fn(),
  validateMiniAppData: vi.fn(),
  parseMiniAppInitData: vi.fn(),
}));

const BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz";
const BOT_USERNAME = "test_bot";

function baseOpts(overrides: Record<string, any> = {}) {
  return { botToken: BOT_TOKEN, botUsername: BOT_USERNAME, ...overrides };
}

describe("loginWidget option", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Schema derivation ──────────────────────────────────────────────

  describe("schema derivation", () => {
    it("default options → schema has user and account fields", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts());

      expect(plugin.schema).toBeDefined();
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramId");
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramUsername");
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramPhoneNumber");
      expect(plugin.schema?.account?.fields).toHaveProperty("telegramId");
      expect(plugin.schema?.account?.fields).toHaveProperty("telegramUsername");
    });

    it("loginWidget: true → schema has user and account fields", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts({ loginWidget: true }));

      expect(plugin.schema).toBeDefined();
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramId");
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramUsername");
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramPhoneNumber");
      expect(plugin.schema?.account?.fields).toHaveProperty("telegramId");
      expect(plugin.schema?.account?.fields).toHaveProperty("telegramUsername");
    });

    it("loginWidget: false → schema is undefined", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts({ loginWidget: false }));

      expect(plugin.schema).toBeUndefined();
    });

    it("loginWidget: false + miniApp enabled → schema has fields (miniApp needs them)", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(
        baseOpts({ loginWidget: false, miniApp: { enabled: true } })
      );

      expect(plugin.schema).toBeDefined();
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramId");
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramUsername");
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramPhoneNumber");
      expect(plugin.schema?.account?.fields).toHaveProperty("telegramId");
      expect(plugin.schema?.account?.fields).toHaveProperty("telegramUsername");
    });

    it("loginWidget: false + oidc enabled → schema is undefined (OIDC doesn't need telegramId fields)", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(
        baseOpts({ loginWidget: false, oidc: { enabled: true } })
      );

      expect(plugin.schema).toBeUndefined();
    });

    it("loginWidget: false + miniApp enabled + oidc enabled → schema has fields (miniApp wins)", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(
        baseOpts({
          loginWidget: false,
          miniApp: { enabled: true },
          oidc: { enabled: true },
        })
      );

      expect(plugin.schema).toBeDefined();
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramId");
      expect(plugin.schema?.account?.fields).toHaveProperty("telegramId");
    });
  });

  // ── Endpoint registration ──────────────────────────────────────────

  describe("endpoint registration", () => {
    it("default → has signInWithTelegram, linkTelegram, unlinkTelegram endpoints", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts());

      expect(plugin.endpoints).toHaveProperty("signInWithTelegram");
      expect(plugin.endpoints).toHaveProperty("linkTelegram");
      expect(plugin.endpoints).toHaveProperty("unlinkTelegram");
    });

    it("loginWidget: false → does NOT have signInWithTelegram, linkTelegram, unlinkTelegram", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts({ loginWidget: false }));

      expect(plugin.endpoints).not.toHaveProperty("signInWithTelegram");
      expect(plugin.endpoints).not.toHaveProperty("linkTelegram");
      expect(plugin.endpoints).not.toHaveProperty("unlinkTelegram");
    });

    it("loginWidget: false → still has getTelegramConfig endpoint (always present)", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts({ loginWidget: false }));

      expect(plugin.endpoints).toHaveProperty("getTelegramConfig");
    });

    it("loginWidget: false + miniApp enabled → has Mini App endpoints, no Widget endpoints", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(
        baseOpts({ loginWidget: false, miniApp: { enabled: true } })
      );

      // Mini App endpoints present
      expect(plugin.endpoints).toHaveProperty("signInWithMiniApp");
      expect(plugin.endpoints).toHaveProperty("validateMiniApp");

      // Widget endpoints absent
      expect(plugin.endpoints).not.toHaveProperty("signInWithTelegram");
      expect(plugin.endpoints).not.toHaveProperty("linkTelegram");
      expect(plugin.endpoints).not.toHaveProperty("unlinkTelegram");

      // Config always present
      expect(plugin.endpoints).toHaveProperty("getTelegramConfig");
    });

    it("loginWidget: true + miniApp enabled → has both Widget and Mini App endpoints", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(
        baseOpts({ loginWidget: true, miniApp: { enabled: true } })
      );

      // Widget endpoints
      expect(plugin.endpoints).toHaveProperty("signInWithTelegram");
      expect(plugin.endpoints).toHaveProperty("linkTelegram");
      expect(plugin.endpoints).toHaveProperty("unlinkTelegram");

      // Mini App endpoints
      expect(plugin.endpoints).toHaveProperty("signInWithMiniApp");
      expect(plugin.endpoints).toHaveProperty("validateMiniApp");

      // Config
      expect(plugin.endpoints).toHaveProperty("getTelegramConfig");
    });
  });

  // ── Config response ────────────────────────────────────────────────

  describe("config response", () => {
    it("default → config handler returns loginWidgetEnabled: true", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts());

      const configHandler = plugin.endpoints.getTelegramConfig as any;
      const mockCtx = { json: vi.fn((data: any) => data) };
      const result = await configHandler(mockCtx as any);

      expect(result).toHaveProperty("loginWidgetEnabled", true);
    });

    it("loginWidget: false → config handler returns loginWidgetEnabled: false", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts({ loginWidget: false }));

      const configHandler = plugin.endpoints.getTelegramConfig as any;
      const mockCtx = { json: vi.fn((data: any) => data) };
      const result = await configHandler(mockCtx as any);

      expect(result).toHaveProperty("loginWidgetEnabled", false);
    });

    it("loginWidget: true → config handler returns loginWidgetEnabled: true", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts({ loginWidget: true }));

      const configHandler = plugin.endpoints.getTelegramConfig as any;
      const mockCtx = { json: vi.fn((data: any) => data) };
      const result = await configHandler(mockCtx as any);

      expect(result).toHaveProperty("loginWidgetEnabled", true);
    });
  });

  // ── Rate limits ────────────────────────────────────────────────────

  describe("rate limits", () => {
    it("default → rateLimit has Widget entries (signin, link, unlink)", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts());

      const matchers = plugin.rateLimit.map((r) => r.pathMatcher);

      expect(matchers.some((m) => m("/telegram/signin"))).toBe(true);
      expect(matchers.some((m) => m("/telegram/link"))).toBe(true);
      expect(matchers.some((m) => m("/telegram/unlink"))).toBe(true);
    });

    it("loginWidget: false → rateLimit has no Widget entries", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts({ loginWidget: false }));

      const matchers = plugin.rateLimit.map((r) => r.pathMatcher);

      expect(matchers.some((m) => m("/telegram/signin"))).toBe(false);
      expect(matchers.some((m) => m("/telegram/link"))).toBe(false);
      expect(matchers.some((m) => m("/telegram/unlink"))).toBe(false);
    });

    it("loginWidget: false + miniApp enabled → rateLimit has Mini App entries only", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(
        baseOpts({ loginWidget: false, miniApp: { enabled: true } })
      );

      const matchers = plugin.rateLimit.map((r) => r.pathMatcher);

      // Mini App rate limits present
      expect(matchers.some((m) => m("/telegram/miniapp/signin"))).toBe(true);
      expect(matchers.some((m) => m("/telegram/miniapp/validate"))).toBe(true);

      // Widget rate limits absent
      expect(matchers.some((m) => m("/telegram/signin"))).toBe(false);
      expect(matchers.some((m) => m("/telegram/link"))).toBe(false);
      expect(matchers.some((m) => m("/telegram/unlink"))).toBe(false);
    });

    it("loginWidget: false + miniApp disabled → rateLimit is empty array", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(
        baseOpts({ loginWidget: false, miniApp: { enabled: false } })
      );

      expect(plugin.rateLimit).toEqual([]);
    });
  });

  // ── Edge cases & adversarial ───────────────────────────────────────

  describe("edge cases & adversarial", () => {
    it("all three options enabled (widget + miniApp + oidc) → all endpoints present, schema has fields, init hook present", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(
        baseOpts({
          loginWidget: true,
          miniApp: { enabled: true },
          oidc: { enabled: true },
        })
      );

      // Widget endpoints
      expect(plugin.endpoints).toHaveProperty("signInWithTelegram");
      expect(plugin.endpoints).toHaveProperty("linkTelegram");
      expect(plugin.endpoints).toHaveProperty("unlinkTelegram");

      // Mini App endpoints
      expect(plugin.endpoints).toHaveProperty("signInWithMiniApp");
      expect(plugin.endpoints).toHaveProperty("validateMiniApp");

      // Config
      expect(plugin.endpoints).toHaveProperty("getTelegramConfig");

      // Schema
      expect(plugin.schema).toBeDefined();
      expect(plugin.schema?.user?.fields).toHaveProperty("telegramId");
      expect(plugin.schema?.account?.fields).toHaveProperty("telegramId");

      // OIDC init hook
      expect(plugin).toHaveProperty("init");
      expect(typeof (plugin as any).init).toBe("function");
    });

    it("loginWidget: undefined (explicitly) → behaves same as default (true)", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts({ loginWidget: undefined }));

      // Widget endpoints present
      expect(plugin.endpoints).toHaveProperty("signInWithTelegram");
      expect(plugin.endpoints).toHaveProperty("linkTelegram");
      expect(plugin.endpoints).toHaveProperty("unlinkTelegram");

      // Schema present
      expect(plugin.schema).toBeDefined();

      // Rate limits include Widget entries
      const matchers = plugin.rateLimit.map((r) => r.pathMatcher);
      expect(matchers.some((m) => m("/telegram/signin"))).toBe(true);

      // Config reports enabled
      const configHandler = plugin.endpoints.getTelegramConfig as any;
      const mockCtx = { json: vi.fn((data: any) => data) };
      const result = await configHandler(mockCtx as any);
      expect(result).toHaveProperty("loginWidgetEnabled", true);
    });

    it("OIDC init hook is present regardless of loginWidget setting", async () => {
      const { telegram } = await import("./index");

      const pluginWidgetOn = telegram(
        baseOpts({ loginWidget: true, oidc: { enabled: true } })
      );
      const pluginWidgetOff = telegram(
        baseOpts({ loginWidget: false, oidc: { enabled: true } })
      );

      expect(pluginWidgetOn).toHaveProperty("init");
      expect(typeof (pluginWidgetOn as any).init).toBe("function");

      expect(pluginWidgetOff).toHaveProperty("init");
      expect(typeof (pluginWidgetOff as any).init).toBe("function");
    });

    it("testMode warning fires regardless of loginWidget setting (when testMode + oidc enabled)", async () => {
      const { telegram } = await import("./index");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      telegram(
        baseOpts({
          loginWidget: false,
          testMode: true,
          oidc: { enabled: true },
        })
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("testMode is enabled with OIDC")
      );

      warnSpy.mockRestore();
    });

    it("plugin id is always 'telegram' regardless of loginWidget", async () => {
      const { telegram } = await import("./index");

      const pluginDefault = telegram(baseOpts());
      const pluginTrue = telegram(baseOpts({ loginWidget: true }));
      const pluginFalse = telegram(baseOpts({ loginWidget: false }));

      expect(pluginDefault.id).toBe("telegram");
      expect(pluginTrue.id).toBe("telegram");
      expect(pluginFalse.id).toBe("telegram");
    });

    it("$ERROR_CODES is always present regardless of loginWidget", async () => {
      const { telegram } = await import("./index");

      const pluginDefault = telegram(baseOpts());
      const pluginFalse = telegram(baseOpts({ loginWidget: false }));

      expect(pluginDefault.$ERROR_CODES).toBeDefined();
      expect(pluginFalse.$ERROR_CODES).toBeDefined();

      // Both should reference the same error codes
      expect(pluginDefault.$ERROR_CODES).toEqual(pluginFalse.$ERROR_CODES);
    });
  });

  // ── Backward compatibility ─────────────────────────────────────────

  describe("backward compatibility", () => {
    it("default plugin shape matches expected v1.4.0 shape (has all Widget endpoints + schema)", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts());

      // All Widget endpoints
      expect(plugin.endpoints).toHaveProperty("signInWithTelegram");
      expect(plugin.endpoints).toHaveProperty("linkTelegram");
      expect(plugin.endpoints).toHaveProperty("unlinkTelegram");
      expect(plugin.endpoints).toHaveProperty("getTelegramConfig");

      // Schema
      expect(plugin.schema).toBeDefined();

      // Rate limits for Widget
      expect(plugin.rateLimit.length).toBeGreaterThanOrEqual(3);

      // Plugin metadata
      expect(plugin.id).toBe("telegram");
      expect(plugin.$ERROR_CODES).toBeDefined();
    });

    it("default plugin schema has exact 3 user fields and 2 account fields", async () => {
      const { telegram } = await import("./index");
      const plugin = telegram(baseOpts());

      const userFieldNames = Object.keys(plugin.schema?.user?.fields ?? {});
      const accountFieldNames = Object.keys(
        plugin.schema?.account?.fields ?? {}
      );

      expect(userFieldNames).toHaveLength(3);
      expect(userFieldNames).toContain("telegramId");
      expect(userFieldNames).toContain("telegramUsername");
      expect(userFieldNames).toContain("telegramPhoneNumber");

      expect(accountFieldNames).toHaveLength(2);
      expect(accountFieldNames).toContain("telegramId");
      expect(accountFieldNames).toContain("telegramUsername");
    });
  });
});
