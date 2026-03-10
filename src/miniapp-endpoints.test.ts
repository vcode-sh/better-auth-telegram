/**
 * @vitest-environment happy-dom
 *
 * Tests for miniapp-endpoints.ts — signIn and validate handlers.
 * Covers every branch: initData validation, HMAC verification,
 * existing account, existing user by telegramId, auto-create,
 * auto-create disabled, auto-signin disabled, custom mapper,
 * and validate endpoint (valid/invalid).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  verifyMiniAppInitData: vi.fn(),
  parseMiniAppInitData: vi.fn(),
  validateMiniAppData: vi.fn(),
}));

import { ERROR_CODES } from "./constants";
import {
  createMiniAppEndpoints,
  getMiniAppRateLimits,
} from "./miniapp-endpoints";
import type { TelegramPluginConfig } from "./plugin-config";
import {
  parseMiniAppInitData,
  validateMiniAppData,
  verifyMiniAppInitData,
} from "./verify";

const mockedVerify = vi.mocked(verifyMiniAppInitData);
const mockedParse = vi.mocked(parseMiniAppInitData);
const mockedValidate = vi.mocked(validateMiniAppData);

const INIT_DATA = "user=%7B%22id%22%3A99%7D&auth_date=1700000000&hash=abc";

const PARSED_DATA = {
  user: {
    id: 99,
    first_name: "Bob",
    last_name: "Jones",
    username: "bobjones",
    photo_url: "https://t.me/bob.jpg",
  },
  auth_date: 1700000000,
  hash: "abc",
};

function makeConfig(
  overrides: Partial<TelegramPluginConfig> = {}
): TelegramPluginConfig {
  return {
    botToken: "tok:en",
    botUsername: "bot",
    widgetEnabled: false,
    miniAppEnabled: true,
    oidcEnabled: false,
    testMode: false,
    allowUserToLink: true,
    autoCreateUser: true,
    maxAuthAge: 86400,
    miniAppValidateInitData: true,
    miniAppAllowAutoSignin: true,
    ...overrides,
  };
}

function mockAdapter(overrides: Record<string, any> = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "new-id" }),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

function mockCtx(adapter: any, body: any) {
  return {
    body: Promise.resolve(body),
    context: {
      adapter,
      internalAdapter: {
        createSession: vi
          .fn()
          .mockResolvedValue({ id: "sess-1", token: "tok" }),
      },
    },
    json: vi.fn((data: any) => data),
  };
}

// ── signInWithMiniApp ──────────────────────────────────────────────────

describe("signInWithMiniApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerify.mockResolvedValue(true);
    mockedParse.mockReturnValue(PARSED_DATA as any);
    mockedValidate.mockReturnValue(true);
  });

  it("rejects when initData is missing", async () => {
    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), {});

    await expect(
      (endpoints.signInWithMiniApp as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.INIT_DATA_REQUIRED.message);
  });

  it("rejects when initData is not a string", async () => {
    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), { initData: 12345 });

    await expect(
      (endpoints.signInWithMiniApp as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.INIT_DATA_REQUIRED.message);
  });

  it("rejects invalid initData verification", async () => {
    mockedVerify.mockResolvedValue(false);
    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), { initData: INIT_DATA });

    await expect(
      (endpoints.signInWithMiniApp as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.INVALID_MINI_APP_INIT_DATA.message);
  });

  it("skips verification when miniAppValidateInitData is false", async () => {
    mockedVerify.mockResolvedValue(false); // would fail if called
    const adapter = mockAdapter({
      findOne: vi.fn().mockResolvedValue({ userId: "u1", id: "a1" }),
    });

    const endpoints = createMiniAppEndpoints(
      makeConfig({ miniAppValidateInitData: false })
    );
    const ctx = mockCtx(adapter, { initData: INIT_DATA });

    // Should NOT throw despite verify returning false
    await (endpoints.signInWithMiniApp as any)(ctx);
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it("rejects invalid data structure", async () => {
    mockedValidate.mockReturnValue(false);
    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), { initData: INIT_DATA });

    await expect(
      (endpoints.signInWithMiniApp as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.INVALID_MINI_APP_DATA_STRUCTURE.message);
  });

  it("rejects when no user in initData", async () => {
    mockedParse.mockReturnValue({
      auth_date: 1700000000,
      hash: "abc",
    } as any);

    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), { initData: INIT_DATA });

    await expect(
      (endpoints.signInWithMiniApp as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.NO_USER_IN_INIT_DATA.message);
  });

  it("signs in with existing account", async () => {
    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model }: any) => {
        if (model === "account") return { userId: "existing-u", id: "a1" };
        if (model === "user") return { id: "existing-u", name: "Bob" };
        return null;
      }),
    });

    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(adapter, { initData: INIT_DATA });
    await (endpoints.signInWithMiniApp as any)(ctx);

    expect(adapter.create).not.toHaveBeenCalled();
    expect(ctx.context.internalAdapter.createSession).toHaveBeenCalledWith(
      "existing-u"
    );
  });

  it("links existing user found by telegramId", async () => {
    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model, where }: any) => {
        if (model === "account") return null;
        if (model === "user") {
          const tgFilter = where.find((w: any) => w.field === "telegramId");
          if (tgFilter) return { id: "user-tg" };
          const idFilter = where.find((w: any) => w.field === "id");
          if (idFilter) return { id: "user-tg", name: "Bob" };
        }
        return null;
      }),
    });

    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(adapter, { initData: INIT_DATA });
    await (endpoints.signInWithMiniApp as any)(ctx);

    // Should create account link only
    expect(adapter.create).toHaveBeenCalledTimes(1);
    expect(adapter.create).toHaveBeenCalledWith({
      model: "account",
      data: {
        userId: "user-tg",
        providerId: "telegram",
        accountId: "99",
        telegramId: "99",
        telegramUsername: "bobjones",
      },
    });
  });

  it("creates new user when autoCreateUser and miniAppAllowAutoSignin are true", async () => {
    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model, where }: any) => {
        if (model === "user") {
          const idFilter = where.find((w: any) => w.field === "id");
          if (idFilter) return { id: "new-u", name: "Bob Jones" };
        }
        return null;
      }),
      create: vi.fn().mockImplementation(({ model }: any) => {
        if (model === "user") return { id: "new-u" };
        return { id: "acc-1" };
      }),
    });

    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(adapter, { initData: INIT_DATA });
    await (endpoints.signInWithMiniApp as any)(ctx);

    // user + account created
    expect(adapter.create).toHaveBeenCalledTimes(2);
    expect(adapter.create.mock.calls[0]![0].model).toBe("user");
    expect(adapter.create.mock.calls[0]![0].data.name).toBe("Bob Jones");
    expect(adapter.create.mock.calls[0]![0].data.telegramId).toBe("99");
    expect(adapter.create.mock.calls[1]![0].model).toBe("account");
  });

  it("throws when autoCreateUser is false and no user exists", async () => {
    const endpoints = createMiniAppEndpoints(
      makeConfig({ autoCreateUser: false })
    );
    const ctx = mockCtx(mockAdapter(), { initData: INIT_DATA });

    await expect(
      (endpoints.signInWithMiniApp as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.MINI_APP_AUTO_SIGNIN_DISABLED.message);
  });

  it("throws when miniAppAllowAutoSignin is false and no user exists", async () => {
    const endpoints = createMiniAppEndpoints(
      makeConfig({ miniAppAllowAutoSignin: false })
    );
    const ctx = mockCtx(mockAdapter(), { initData: INIT_DATA });

    await expect(
      (endpoints.signInWithMiniApp as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.MINI_APP_AUTO_SIGNIN_DISABLED.message);
  });

  it("uses mapMiniAppDataToUser when provided", async () => {
    const mapper = vi.fn(() => ({
      name: "Custom Bob",
      email: "bob@example.com",
    }));

    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model, where }: any) => {
        if (model === "user") {
          const idFilter = where.find((w: any) => w.field === "id");
          if (idFilter) return { id: "new-u" };
        }
        return null;
      }),
      create: vi.fn().mockResolvedValue({ id: "new-u" }),
    });

    const endpoints = createMiniAppEndpoints(
      makeConfig({ mapMiniAppDataToUser: mapper })
    );
    const ctx = mockCtx(adapter, { initData: INIT_DATA });
    await (endpoints.signInWithMiniApp as any)(ctx);

    expect(mapper).toHaveBeenCalledWith(PARSED_DATA.user);
    expect(adapter.create.mock.calls[0]![0].data.name).toBe("Custom Bob");
  });

  it("builds name without last_name", async () => {
    mockedParse.mockReturnValue({
      user: { id: 99, first_name: "Bob" },
      auth_date: 1700000000,
      hash: "abc",
    } as any);

    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model, where }: any) => {
        if (model === "user") {
          const idFilter = where.find((w: any) => w.field === "id");
          if (idFilter) return { id: "u1" };
        }
        return null;
      }),
      create: vi.fn().mockResolvedValue({ id: "u1" }),
    });

    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(adapter, { initData: INIT_DATA });
    await (endpoints.signInWithMiniApp as any)(ctx);

    expect(adapter.create.mock.calls[0]![0].data.name).toBe("Bob");
  });

  it("passes botToken and maxAuthAge to verifyMiniAppInitData", async () => {
    const config = makeConfig({ botToken: "my:tok", maxAuthAge: 500 });
    const adapter = mockAdapter({
      findOne: vi.fn().mockResolvedValue({ userId: "u1", id: "a1" }),
    });

    const endpoints = createMiniAppEndpoints(config);
    const ctx = mockCtx(adapter, { initData: INIT_DATA });
    await (endpoints.signInWithMiniApp as any)(ctx);

    expect(mockedVerify).toHaveBeenCalledWith(INIT_DATA, "my:tok", 500);
  });
});

// ── validateMiniApp ──────────────────────────────────────────────────

describe("validateMiniApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when initData is missing", async () => {
    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), {});

    await expect(
      (endpoints.validateMiniApp as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.INIT_DATA_REQUIRED.message);
  });

  it("rejects when initData is not a string", async () => {
    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), { initData: 42 });

    await expect(
      (endpoints.validateMiniApp as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.INIT_DATA_REQUIRED.message);
  });

  it("returns valid: false when verification fails", async () => {
    mockedVerify.mockResolvedValue(false);

    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), { initData: INIT_DATA });
    await (endpoints.validateMiniApp as any)(ctx);

    expect(ctx.json).toHaveBeenCalledWith({
      valid: false,
      data: null,
    });
  });

  it("returns valid: true with parsed data when verification succeeds", async () => {
    mockedVerify.mockResolvedValue(true);
    mockedParse.mockReturnValue(PARSED_DATA as any);

    const endpoints = createMiniAppEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), { initData: INIT_DATA });
    await (endpoints.validateMiniApp as any)(ctx);

    expect(ctx.json).toHaveBeenCalledWith({
      valid: true,
      data: PARSED_DATA,
    });
  });

  it("passes botToken and maxAuthAge to verify", async () => {
    mockedVerify.mockResolvedValue(false);
    const config = makeConfig({ botToken: "x:y", maxAuthAge: 123 });

    const endpoints = createMiniAppEndpoints(config);
    const ctx = mockCtx(mockAdapter(), { initData: INIT_DATA });
    await (endpoints.validateMiniApp as any)(ctx);

    expect(mockedVerify).toHaveBeenCalledWith(INIT_DATA, "x:y", 123);
  });
});

// ── Rate limits ───────────────────────────────────────────────────────

describe("getMiniAppRateLimits", () => {
  it("returns 2 rate limit rules", () => {
    const limits = getMiniAppRateLimits();
    expect(limits).toHaveLength(2);
  });

  it("matches correct paths", () => {
    const limits = getMiniAppRateLimits();
    expect(limits[0]!.pathMatcher("/telegram/miniapp/signin")).toBe(true);
    expect(limits[0]!.pathMatcher("/telegram/miniapp/validate")).toBe(false);
    expect(limits[1]!.pathMatcher("/telegram/miniapp/validate")).toBe(true);
    expect(limits[1]!.pathMatcher("/telegram/miniapp/signin")).toBe(false);
  });
});
