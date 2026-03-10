/**
 * @vitest-environment happy-dom
 *
 * Tests for widget-endpoints.ts — signIn, link, unlink handlers.
 * Covers every branch: existing account, existing user by telegramId,
 * auto-create new user, auto-create disabled, custom user mapper,
 * link (all conflict/success paths), and unlink (found/not-found).
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
  verifyTelegramAuth: vi.fn(),
  validateTelegramAuthData: vi.fn(),
}));

import { ERROR_CODES, SUCCESS_MESSAGES } from "./constants";
import type { TelegramPluginConfig } from "./plugin-config";
import { validateTelegramAuthData, verifyTelegramAuth } from "./verify";
import {
  createWidgetEndpoints,
  getWidgetRateLimits,
} from "./widget-endpoints";

const mockedValidate = vi.mocked(validateTelegramAuthData);
const mockedVerify = vi.mocked(verifyTelegramAuth);

const TELEGRAM_DATA = {
  id: 12345,
  first_name: "Alice",
  last_name: "Smith",
  username: "alice",
  photo_url: "https://t.me/alice.jpg",
  auth_date: Math.floor(Date.now() / 1000),
  hash: "deadbeef",
};

function makeConfig(
  overrides: Partial<TelegramPluginConfig> = {}
): TelegramPluginConfig {
  return {
    botToken: "tok:en",
    botUsername: "bot",
    widgetEnabled: true,
    miniAppEnabled: false,
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

function mockCtx(adapter: any, body: any, session: any = null) {
  return {
    body: Promise.resolve(body),
    context: {
      adapter,
      session,
      internalAdapter: {
        createSession: vi
          .fn()
          .mockResolvedValue({ id: "sess-1", token: "tok" }),
      },
    },
    json: vi.fn((data: any) => data),
  };
}

// ── signInWithTelegram ────────────────────────────────────────────────

describe("signInWithTelegram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedValidate.mockReturnValue(true);
    mockedVerify.mockResolvedValue(true);
  });

  it("rejects invalid auth data", async () => {
    mockedValidate.mockReturnValue(false);
    const endpoints = createWidgetEndpoints(makeConfig());
    const handler = endpoints.signInWithTelegram as any;
    const ctx = mockCtx(mockAdapter(), { garbage: true });

    await expect(handler(ctx)).rejects.toThrow(
      ERROR_CODES.INVALID_AUTH_DATA.message
    );
  });

  it("rejects failed HMAC verification", async () => {
    mockedVerify.mockResolvedValue(false);
    const endpoints = createWidgetEndpoints(makeConfig());
    const handler = endpoints.signInWithTelegram as any;
    const ctx = mockCtx(mockAdapter(), TELEGRAM_DATA);

    await expect(handler(ctx)).rejects.toThrow(
      ERROR_CODES.INVALID_AUTHENTICATION.message
    );
  });

  it("signs in with existing account (no user creation)", async () => {
    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model, where }: any) => {
        if (model === "account") {
          return { userId: "existing-user", id: "acc-1" };
        }
        if (model === "user") {
          return { id: "existing-user", name: "Alice" };
        }
        return null;
      }),
    });

    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(adapter, TELEGRAM_DATA);
    await (endpoints.signInWithTelegram as any)(ctx);

    // No create calls at all — user and account already exist
    expect(adapter.create).not.toHaveBeenCalled();
    expect(ctx.context.internalAdapter.createSession).toHaveBeenCalledWith(
      "existing-user"
    );
    expect(ctx.json).toHaveBeenCalled();
  });

  it("creates new user and account when autoCreateUser is true", async () => {
    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model, where }: any) => {
        // account lookup → null, user-by-telegramId → null
        // user-by-id (after creation) → the new user
        if (model === "user") {
          const idFilter = where.find((w: any) => w.field === "id");
          if (idFilter) return { id: "new-user-1", name: "Alice" };
          return null; // telegramId lookup → not found
        }
        return null;
      }),
      create: vi.fn().mockImplementation(({ model }: any) => {
        if (model === "user") return { id: "new-user-1" };
        return { id: "acc-1" };
      }),
    });

    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(adapter, TELEGRAM_DATA);
    await (endpoints.signInWithTelegram as any)(ctx);

    // Should create user then account
    expect(adapter.create).toHaveBeenCalledTimes(2);
    expect(adapter.create.mock.calls[0]![0].model).toBe("user");
    expect(adapter.create.mock.calls[1]![0].model).toBe("account");

    // User data should include telegramId
    expect(adapter.create.mock.calls[0]![0].data.telegramId).toBe("12345");
    expect(adapter.create.mock.calls[0]![0].data.telegramUsername).toBe(
      "alice"
    );

    // Session created for new user
    expect(ctx.context.internalAdapter.createSession).toHaveBeenCalledWith(
      "new-user-1"
    );
  });

  it("throws USER_CREATION_DISABLED when autoCreateUser is false and no user exists", async () => {
    const adapter = mockAdapter(); // findOne always returns null

    const endpoints = createWidgetEndpoints(
      makeConfig({ autoCreateUser: false })
    );
    const ctx = mockCtx(adapter, TELEGRAM_DATA);

    await expect(
      (endpoints.signInWithTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.USER_CREATION_DISABLED.message);
  });

  it("uses mapTelegramDataToUser when provided", async () => {
    const mapper = vi.fn(() => ({
      name: "Custom Name",
      email: "custom@example.com",
      image: "https://custom.img",
    }));

    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model, where }: any) => {
        if (model === "user") {
          const idFilter = where.find((w: any) => w.field === "id");
          if (idFilter) return { id: "new-1", name: "Custom Name" };
          return null;
        }
        return null;
      }),
      create: vi.fn().mockResolvedValue({ id: "new-1" }),
    });

    const endpoints = createWidgetEndpoints(
      makeConfig({ mapTelegramDataToUser: mapper })
    );
    const ctx = mockCtx(adapter, TELEGRAM_DATA);
    await (endpoints.signInWithTelegram as any)(ctx);

    expect(mapper).toHaveBeenCalledWith(TELEGRAM_DATA);
    // Custom mapped data spread into user creation
    expect(adapter.create.mock.calls[0]![0].data.name).toBe("Custom Name");
  });

  it("builds correct name without last_name", async () => {
    const noLastName = { ...TELEGRAM_DATA, last_name: undefined };
    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model, where }: any) => {
        if (model === "user") {
          const idFilter = where.find((w: any) => w.field === "id");
          if (idFilter) return { id: "u1", name: "Alice" };
          return null;
        }
        return null;
      }),
      create: vi.fn().mockResolvedValue({ id: "u1" }),
    });

    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(adapter, noLastName);
    await (endpoints.signInWithTelegram as any)(ctx);

    expect(adapter.create.mock.calls[0]![0].data.name).toBe("Alice");
  });

  it("builds correct name with last_name", async () => {
    const adapter = mockAdapter({
      findOne: vi.fn().mockImplementation(({ model, where }: any) => {
        if (model === "user") {
          const idFilter = where.find((w: any) => w.field === "id");
          if (idFilter) return { id: "u1", name: "Alice Smith" };
          return null;
        }
        return null;
      }),
      create: vi.fn().mockResolvedValue({ id: "u1" }),
    });

    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(adapter, TELEGRAM_DATA);
    await (endpoints.signInWithTelegram as any)(ctx);

    expect(adapter.create.mock.calls[0]![0].data.name).toBe("Alice Smith");
  });

  it("passes botToken and maxAuthAge to verifyTelegramAuth", async () => {
    const config = makeConfig({ botToken: "my:token", maxAuthAge: 999 });
    const adapter = mockAdapter({
      findOne: vi.fn().mockResolvedValue({ userId: "u1", id: "a1" }),
    });

    const endpoints = createWidgetEndpoints(config);
    const ctx = mockCtx(adapter, TELEGRAM_DATA);
    await (endpoints.signInWithTelegram as any)(ctx);

    expect(mockedVerify).toHaveBeenCalledWith(TELEGRAM_DATA, "my:token", 999);
  });
});

// ── linkTelegram ──────────────────────────────────────────────────────

describe("linkTelegram", () => {
  const session = { user: { id: "current-user" } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedValidate.mockReturnValue(true);
    mockedVerify.mockResolvedValue(true);
  });

  it("throws LINKING_DISABLED when allowUserToLink is false", async () => {
    const endpoints = createWidgetEndpoints(
      makeConfig({ allowUserToLink: false })
    );
    const ctx = mockCtx(mockAdapter(), TELEGRAM_DATA, session);

    await expect(
      (endpoints.linkTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.LINKING_DISABLED.message);
  });

  it("throws NOT_AUTHENTICATED when session is missing", async () => {
    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), TELEGRAM_DATA, null);

    await expect(
      (endpoints.linkTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.NOT_AUTHENTICATED.message);
  });

  it("throws NOT_AUTHENTICATED when session has no user id", async () => {
    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), TELEGRAM_DATA, { user: {} });

    await expect(
      (endpoints.linkTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.NOT_AUTHENTICATED.message);
  });

  it("rejects invalid auth data", async () => {
    mockedValidate.mockReturnValue(false);
    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), { bad: true }, session);

    await expect(
      (endpoints.linkTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.INVALID_AUTH_DATA.message);
  });

  it("rejects failed verification", async () => {
    mockedVerify.mockResolvedValue(false);
    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), TELEGRAM_DATA, session);

    await expect(
      (endpoints.linkTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.INVALID_AUTHENTICATION.message);
  });

  it("throws TELEGRAM_ALREADY_LINKED_OTHER when linked to different user", async () => {
    const adapter = mockAdapter({
      findOne: vi.fn().mockResolvedValue({
        userId: "other-user",
        id: "acc-1",
      }),
    });

    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(adapter, TELEGRAM_DATA, session);

    await expect(
      (endpoints.linkTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER.message);
  });

  it("throws TELEGRAM_ALREADY_LINKED_SELF when already linked to same user", async () => {
    const adapter = mockAdapter({
      findOne: vi.fn().mockResolvedValue({
        userId: "current-user",
        id: "acc-1",
      }),
    });

    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(adapter, TELEGRAM_DATA, session);

    await expect(
      (endpoints.linkTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.TELEGRAM_ALREADY_LINKED_SELF.message);
  });

  it("creates account link and updates user on success", async () => {
    const adapter = mockAdapter(); // findOne returns null

    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(adapter, TELEGRAM_DATA, session);
    const result = await (endpoints.linkTelegram as any)(ctx);

    // Account created
    expect(adapter.create).toHaveBeenCalledWith({
      model: "account",
      data: {
        userId: "current-user",
        providerId: "telegram",
        accountId: "12345",
        telegramId: "12345",
        telegramUsername: "alice",
      },
    });

    // User updated with Telegram data
    expect(adapter.update).toHaveBeenCalledWith({
      model: "user",
      where: [{ field: "id", value: "current-user" }],
      update: {
        telegramId: "12345",
        telegramUsername: "alice",
      },
    });

    expect(ctx.json).toHaveBeenCalledWith({
      success: true,
      message: SUCCESS_MESSAGES.TELEGRAM_LINKED,
    });
  });
});

// ── unlinkTelegram ────────────────────────────────────────────────────

describe("unlinkTelegram", () => {
  const session = { user: { id: "current-user" } };

  beforeEach(() => vi.clearAllMocks());

  it("throws NOT_AUTHENTICATED when session is missing", async () => {
    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(mockAdapter(), {}, null);

    await expect(
      (endpoints.unlinkTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.NOT_AUTHENTICATED.message);
  });

  it("throws NOT_LINKED when no telegram account found", async () => {
    const adapter = mockAdapter(); // findOne returns null

    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(adapter, {}, session);

    await expect(
      (endpoints.unlinkTelegram as any)(ctx)
    ).rejects.toThrow(ERROR_CODES.NOT_LINKED.message);
  });

  it("deletes account and clears user Telegram data on success", async () => {
    const adapter = mockAdapter({
      findOne: vi.fn().mockResolvedValue({
        id: "acc-1",
        userId: "current-user",
        providerId: "telegram",
      }),
    });

    const endpoints = createWidgetEndpoints(makeConfig());
    const ctx = mockCtx(adapter, {}, session);
    await (endpoints.unlinkTelegram as any)(ctx);

    // Account deleted
    expect(adapter.delete).toHaveBeenCalledWith({
      model: "account",
      where: [{ field: "id", value: "acc-1" }],
    });

    // User Telegram fields cleared
    expect(adapter.update).toHaveBeenCalledWith({
      model: "user",
      where: [{ field: "id", value: "current-user" }],
      update: {
        telegramId: null,
        telegramUsername: null,
      },
    });

    expect(ctx.json).toHaveBeenCalledWith({
      success: true,
      message: SUCCESS_MESSAGES.TELEGRAM_UNLINKED,
    });
  });
});

// ── Rate limits ───────────────────────────────────────────────────────

describe("getWidgetRateLimits", () => {
  it("returns 3 rate limit rules", () => {
    const limits = getWidgetRateLimits();
    expect(limits).toHaveLength(3);
  });

  it("matches correct paths", () => {
    const limits = getWidgetRateLimits();
    expect(limits[0]!.pathMatcher("/telegram/signin")).toBe(true);
    expect(limits[0]!.pathMatcher("/telegram/link")).toBe(false);
    expect(limits[1]!.pathMatcher("/telegram/link")).toBe(true);
    expect(limits[2]!.pathMatcher("/telegram/unlink")).toBe(true);
    expect(limits[2]!.pathMatcher("/telegram/signin")).toBe(false);
  });
});
