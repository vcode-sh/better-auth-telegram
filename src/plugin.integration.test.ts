// @vitest-environment node
/**
 * Plugin-level contracts against a real Better Auth instance: which routes
 * exist per mode, what the public config endpoint exposes, the rate limits,
 * and the schema Better Auth's migrations create from the plugin.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOT_TOKEN,
  createClient,
  createMemoryAuth,
  createSqliteAuth,
  mockTelegramOIDC,
  signInitData,
  signInWithTelegramOIDC,
  signWidgetData,
} from "./testing/harness";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("routes per mode", () => {
  it("registers no Login Widget routes when loginWidget is false", async () => {
    const { client } = createMemoryAuth({
      loginWidget: false,
      miniApp: { enabled: true },
    });
    const widgetData = await signWidgetData({ id: 42 });

    const signIn = await client.post("/telegram/signin", widgetData);
    const link = await client.post("/telegram/link", widgetData);
    const unlink = await client.post("/telegram/unlink", {});
    const miniApp = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 42 }),
    });
    const config = await client.get("/telegram/config");

    expect([signIn.status, link.status, unlink.status]).toEqual([
      404, 404, 404,
    ]);
    expect(miniApp.status).toBe(200);
    expect(config.status).toBe(200);
    expect(config.json.loginWidgetEnabled).toBe(false);
  });

  it("registers no Mini App routes unless miniApp.enabled", async () => {
    const { client } = createMemoryAuth();
    const initData = await signInitData({ id: 42 });

    const signIn = await client.post("/telegram/miniapp/signin", { initData });
    const validate = await client.post("/telegram/miniapp/validate", {
      initData,
    });

    expect([signIn.status, validate.status]).toEqual([404, 404]);
  });
});

describe("configuration warnings", () => {
  it("go to Better Auth's logger, not straight to the console", async () => {
    const console = vi
      .spyOn(globalThis.console, "warn")
      .mockImplementation(() => undefined);
    const logs: [string, string][] = [];
    const { auth } = createMemoryAuth(
      { botToken: "not-a-token", botUsername: "@test_bot" },
      {
        logger: {
          log: (level, message) => {
            logs.push([level, message]);
          },
        },
      }
    );

    await auth.$context;

    expect(logs).toEqual([
      ["warn", expect.stringContaining("doesn't look like a bot token")],
      ["warn", expect.stringContaining('botUsername "@test_bot"')],
    ]);
    expect(console).not.toHaveBeenCalled();
  });

  it("stay quiet with logger.disabled", async () => {
    const console = vi
      .spyOn(globalThis.console, "warn")
      .mockImplementation(() => undefined);
    const { auth } = createMemoryAuth({ botToken: "not-a-token" });

    await auth.$context;

    expect(console).not.toHaveBeenCalled();
  });
});

describe("GET /telegram/config", () => {
  it("exposes exactly the five documented fields and no secret", async () => {
    const clientSecret = "oidc-client-secret-value";
    const { client } = createMemoryAuth({
      miniApp: { enabled: true },
      oidc: { enabled: true, clientId: "987654321", clientSecret },
    });

    const response = await client.get("/telegram/config");

    expect(response.json).toEqual({
      botUsername: "test_bot",
      loginWidgetEnabled: true,
      miniAppEnabled: true,
      oidcEnabled: true,
      testMode: false,
    });
    expect(response.text).not.toContain(BOT_TOKEN.split(":")[1]);
    expect(response.text).not.toContain(clientSecret);
  });
});

describe("rate limits (Better Auth's limiter)", () => {
  // Documented limits: requests allowed per 60 s window.
  it.each([
    ["/telegram/signin", 10],
    ["/telegram/link", 5],
    ["/telegram/unlink", 5],
    ["/telegram/miniapp/signin", 10],
    ["/telegram/miniapp/validate", 20],
  ])("%s allows %i requests a minute, then answers 429", async (path, max) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_761_730_000_000);
    const { client } = createMemoryAuth(
      { miniApp: { enabled: true } },
      { rateLimit: { enabled: true } }
    );

    const statuses: number[] = [];
    for (let i = 0; i < max; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the limiter counts requests in order
      statuses.push((await client.post(path, {})).status);
    }
    const overLimit = await client.post(path, {});
    vi.setSystemTime(1_761_730_061_000);
    const nextWindow = await client.post(path, {});

    expect(statuses).not.toContain(429);
    expect(overLimit.status).toBe(429);
    expect(nextWindow.status).not.toBe(429);
  });
});

describe("schema created by Better Auth's migrations", () => {
  const columns = (sqlite: { prepare: (sql: string) => any }, table: string) =>
    (
      sqlite.prepare(`PRAGMA table_info("${table}")`).all() as {
        name: string;
      }[]
    )
      .map((column) => column.name)
      .filter((name) => name.startsWith("telegram"))
      .sort();

  it("adds the Telegram columns and indexes user.telegramId", async () => {
    // A missing column makes Better Auth 1.7 fail every request; the index
    // backs the lookup every Login Widget / Mini App sign-in does.
    const { sqlite } = await createSqliteAuth();

    const indexedColumns = (
      sqlite.prepare('PRAGMA index_list("user")').all() as { name: string }[]
    ).flatMap((index) =>
      (
        sqlite.prepare(`PRAGMA index_info("${index.name}")`).all() as {
          name: string;
        }[]
      ).map((column) => column.name)
    );

    expect(columns(sqlite, "user")).toEqual([
      "telegramId",
      "telegramPhoneNumber",
      "telegramUsername",
    ]);
    expect(columns(sqlite, "account")).toEqual([
      "telegramId",
      "telegramUsername",
    ]);
    expect(indexedColumns).toContain("telegramId");
  });

  it("adds no Telegram columns in OIDC-only mode, and OIDC sign-in still works there", async () => {
    const telegramMock = await mockTelegramOIDC();
    try {
      const { sqlite, client, rows } = await createSqliteAuth({
        loginWidget: false,
        oidc: { enabled: true, clientSecret: telegramMock.clientSecret },
      });

      const { location } = await signInWithTelegramOIDC(client, telegramMock);

      expect(columns(sqlite, "user")).toEqual([]);
      expect(columns(sqlite, "account")).toEqual([]);
      expect(location).toBe("/dashboard");
      expect(rows("user")).toHaveLength(1);
    } finally {
      telegramMock.restore();
    }
  });
});

describe("clients cannot write the Telegram identity", () => {
  // Otherwise a user could set telegramId to a victim's id, and the Login
  // Widget lookup by telegramId would sign the victim's Telegram into it.
  const identity = {
    telegramId: "42",
    telegramUsername: "victim",
    telegramPhoneNumber: "48572068680",
  };
  const signUp = (client: ReturnType<typeof createClient>, extra = {}) =>
    client.post("/sign-up/email", {
      email: "ann@example.com",
      password: "correct-horse-battery",
      name: "Ann",
      ...extra,
    });

  it.each(Object.entries(identity))(
    "refuses %s on /sign-up/email",
    async (field, value) => {
      const { client, db } = createMemoryAuth(
        {},
        { emailAndPassword: { enabled: true } }
      );

      const response = await signUp(client, { [field]: value });

      expect(response.status).toBe(400);
      expect(response.json.code).toBe("FIELD_NOT_ALLOWED");
      expect(db.user).toHaveLength(0);
    }
  );

  it.each(Object.entries(identity))(
    "refuses %s on /update-user",
    async (field, value) => {
      const { auth, client, db } = createMemoryAuth(
        {},
        { emailAndPassword: { enabled: true } }
      );
      await signUp(client);

      const update = await client.post("/update-user", { [field]: value });
      const telegram = await createClient(auth).post(
        "/telegram/signin",
        await signWidgetData({ id: 42 })
      );

      expect(update.status).toBe(400);
      expect(update.json.code).toBe("FIELD_NOT_ALLOWED");
      expect(db.user[0]![field] ?? null).toBeNull();
      // Telegram user 42 gets their own account, not Ann's.
      expect(telegram.json.user.email).toBe("42@telegram.placeholder.invalid");
    }
  );
});
