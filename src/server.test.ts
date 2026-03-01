/**
 * @vitest-environment happy-dom
 *
 * Tests for cross-provider account linking (GitHub issue #13).
 *
 * The bug: /telegram/signin and /telegram/miniapp/signin only look for
 * accounts with providerId="telegram". If a user was created via OIDC
 * (providerId="telegram-oidc"), the endpoint doesn't find them, blindly
 * calls adapter.create({ model: "user" }), and the database throws P2002
 * (unique constraint violation) because the user already exists.
 *
 * These tests simulate that exact scenario by making adapter.create throw
 * when called with model: "user" — mimicking Prisma's P2002. If the fix
 * works, adapter.create is never called for "user" because the endpoint
 * finds the existing user by telegramId and links the account instead.
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

import {
  parseMiniAppInitData,
  validateMiniAppData,
  validateTelegramAuthData,
  verifyMiniAppInitData,
  verifyTelegramAuth,
} from "./verify";

const mockedValidateTelegramAuthData = vi.mocked(validateTelegramAuthData);
const mockedVerifyTelegramAuth = vi.mocked(verifyTelegramAuth);
const mockedVerifyMiniAppInitData = vi.mocked(verifyMiniAppInitData);
const mockedValidateMiniAppData = vi.mocked(validateMiniAppData);
const mockedParseMiniAppInitData = vi.mocked(parseMiniAppInitData);

const BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz";
const TELEGRAM_USER_ID = "830000001";

/**
 * Simulates a database with a user created via telegram-oidc.
 * No "telegram" provider account exists — only "telegram-oidc".
 * adapter.create for model "user" throws P2002 (unique constraint)
 * because the user already exists.
 */
function createOIDCUserAdapter() {
  const oidcUser = {
    id: "user-oidc-123",
    name: "Tom Robak",
    email: `${TELEGRAM_USER_ID}@telegram.oidc`,
    telegramId: TELEGRAM_USER_ID,
    telegramUsername: "tomrobak",
  };

  return {
    findOne: vi.fn(({ model, where }: any) => {
      if (model === "account") {
        // Only a telegram-oidc account exists, NOT a telegram account.
        // The endpoint queries providerId="telegram" — it won't find this.
        return Promise.resolve(null);
      }
      if (model === "user") {
        // User lookup by telegramId — this is the fix path
        const telegramIdFilter = where.find(
          (w: any) => w.field === "telegramId"
        );
        if (telegramIdFilter?.value === TELEGRAM_USER_ID) {
          return Promise.resolve(oidcUser);
        }
        // User lookup by id — for session creation after linking
        const idFilter = where.find((w: any) => w.field === "id");
        if (idFilter?.value === oidcUser.id) {
          return Promise.resolve(oidcUser);
        }
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    }),

    create: vi.fn(({ model }: any) => {
      if (model === "user") {
        // This is the P2002. If the code reaches here, the bug is alive.
        throw new Error(
          "PrismaClientKnownRequestError P2002: Unique constraint failed on email"
        );
      }
      // Account creation is fine — that's the fix linking the new provider
      return Promise.resolve({ id: "new-account-id" });
    }),

    update: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockContext(adapter: any, body: any) {
  return {
    body: Promise.resolve(body),
    context: {
      adapter,
      internalAdapter: {
        createSession: vi
          .fn()
          .mockResolvedValue({ id: "session-1", token: "tok-1" }),
      },
    },
    json: vi.fn((data: any) => data),
  };
}

describe("Issue #13: Login Widget P2002 when user exists via OIDC", () => {
  const widgetData = {
    id: Number(TELEGRAM_USER_ID),
    first_name: "Tom",
    last_name: "Robak",
    username: "tomrobak",
    photo_url: "https://t.me/photo.jpg",
    auth_date: Math.floor(Date.now() / 1000),
    hash: "abc123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedValidateTelegramAuthData.mockReturnValue(true);
    mockedVerifyTelegramAuth.mockResolvedValue(true);
  });

  it("should NOT attempt to create a user when one already exists via telegramId", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({ botToken: BOT_TOKEN, botUsername: "test_bot" });
    const handler = plugin.endpoints.signInWithTelegram as any;

    const adapter = createOIDCUserAdapter();
    const ctx = createMockContext(adapter, widgetData);

    // If the bug exists, this throws P2002 from adapter.create({ model: "user" })
    await handler(ctx);

    // The critical assertion: adapter.create must NEVER be called with model: "user"
    // Every create call should be for "account" only (linking the new provider)
    const createCalls = adapter.create.mock.calls;
    const userCreateCalls = createCalls.filter(
      ([arg]: any) => arg.model === "user"
    );
    expect(userCreateCalls).toHaveLength(0);
  });

  it("should create a telegram account linked to the existing OIDC user", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({ botToken: BOT_TOKEN, botUsername: "test_bot" });
    const handler = plugin.endpoints.signInWithTelegram as any;

    const adapter = createOIDCUserAdapter();
    const ctx = createMockContext(adapter, widgetData);
    await handler(ctx);

    // Should create exactly one record: the telegram account
    expect(adapter.create).toHaveBeenCalledTimes(1);
    expect(adapter.create).toHaveBeenCalledWith({
      model: "account",
      data: {
        userId: "user-oidc-123",
        providerId: "telegram",
        accountId: TELEGRAM_USER_ID,
        telegramId: TELEGRAM_USER_ID,
        telegramUsername: "tomrobak",
      },
    });
  });

  it("should create a session for the existing user, not a phantom duplicate", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({ botToken: BOT_TOKEN, botUsername: "test_bot" });
    const handler = plugin.endpoints.signInWithTelegram as any;

    const adapter = createOIDCUserAdapter();
    const ctx = createMockContext(adapter, widgetData);
    await handler(ctx);

    // Session must be created for the existing OIDC user
    expect(ctx.context.internalAdapter.createSession).toHaveBeenCalledWith(
      "user-oidc-123"
    );
  });

  it("should query user by telegramId after account lookup fails", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({ botToken: BOT_TOKEN, botUsername: "test_bot" });
    const handler = plugin.endpoints.signInWithTelegram as any;

    const adapter = createOIDCUserAdapter();
    const ctx = createMockContext(adapter, widgetData);
    await handler(ctx);

    // First findOne: account lookup (providerId=telegram) — returns null
    // Second findOne: user lookup by telegramId — returns the OIDC user
    // Third findOne: user lookup by id for session response
    const findOneCalls = adapter.findOne.mock.calls;
    expect(findOneCalls.length).toBeGreaterThanOrEqual(2);

    // The second call must be the telegramId lookup on the user table
    const secondCall = findOneCalls[1]![0];
    expect(secondCall.model).toBe("user");
    expect(secondCall.where).toEqual([
      { field: "telegramId", value: TELEGRAM_USER_ID },
    ]);
  });

  it("should link existing OIDC user even when autoCreateUser is false", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      autoCreateUser: false,
    });
    const handler = plugin.endpoints.signInWithTelegram as any;

    const adapter = createOIDCUserAdapter();
    const ctx = createMockContext(adapter, widgetData);

    // autoCreateUser=false should not prevent linking to an EXISTING user
    await handler(ctx);

    // Should still link, not throw USER_CREATION_DISABLED
    expect(adapter.create).toHaveBeenCalledTimes(1);
    expect(adapter.create).toHaveBeenCalledWith({
      model: "account",
      data: expect.objectContaining({
        userId: "user-oidc-123",
        providerId: "telegram",
      }),
    });
    expect(ctx.context.internalAdapter.createSession).toHaveBeenCalledWith(
      "user-oidc-123"
    );
  });
});

describe("Issue #13: Mini App P2002 when user exists via OIDC", () => {
  const miniAppInitData =
    "user=%7B%22id%22%3A830000001%2C%22first_name%22%3A%22Tom%22%2C%22username%22%3A%22tomrobak%22%7D&auth_date=1700000000&hash=abc123";

  const parsedMiniAppData = {
    user: {
      id: Number(TELEGRAM_USER_ID),
      first_name: "Tom",
      username: "tomrobak",
    },
    auth_date: 1700000000,
    hash: "abc123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedVerifyMiniAppInitData.mockResolvedValue(true);
    mockedParseMiniAppInitData.mockReturnValue(parsedMiniAppData as any);
    mockedValidateMiniAppData.mockReturnValue(true);
  });

  it("should NOT attempt to create a user when one already exists via telegramId", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      miniApp: { enabled: true },
    });
    const handler = plugin.endpoints.signInWithMiniApp as any;

    const adapter = createOIDCUserAdapter();
    const ctx = createMockContext(adapter, { initData: miniAppInitData });

    // If the bug exists, this throws P2002
    await handler(ctx);

    // Same critical assertion: no user creation
    const createCalls = adapter.create.mock.calls;
    const userCreateCalls = createCalls.filter(
      ([arg]: any) => arg.model === "user"
    );
    expect(userCreateCalls).toHaveLength(0);
  });

  it("should create a telegram account linked to the existing OIDC user", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      miniApp: { enabled: true },
    });
    const handler = plugin.endpoints.signInWithMiniApp as any;

    const adapter = createOIDCUserAdapter();
    const ctx = createMockContext(adapter, { initData: miniAppInitData });
    await handler(ctx);

    expect(adapter.create).toHaveBeenCalledTimes(1);
    expect(adapter.create).toHaveBeenCalledWith({
      model: "account",
      data: {
        userId: "user-oidc-123",
        providerId: "telegram",
        accountId: TELEGRAM_USER_ID,
        telegramId: TELEGRAM_USER_ID,
        telegramUsername: "tomrobak",
      },
    });
  });

  it("should create a session for the existing user, not a phantom duplicate", async () => {
    const { telegram } = await import("./index");
    const plugin = telegram({
      botToken: BOT_TOKEN,
      botUsername: "test_bot",
      miniApp: { enabled: true },
    });
    const handler = plugin.endpoints.signInWithMiniApp as any;

    const adapter = createOIDCUserAdapter();
    const ctx = createMockContext(adapter, { initData: miniAppInitData });
    await handler(ctx);

    expect(ctx.context.internalAdapter.createSession).toHaveBeenCalledWith(
      "user-oidc-123"
    );
  });
});
