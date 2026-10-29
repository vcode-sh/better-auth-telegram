// @vitest-environment node
/**
 * How the Telegram flows behave under Better Auth options and plugins an app
 * may combine them with: origin checks, account linking settings, the
 * session cookie cache, custom table and column names, numeric ids, and the
 * admin and multi-session plugins.
 */
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, bearer, multiSession } from "better-auth/plugins";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { telegram } from "./index";
import {
  BASE_URL,
  BOT_TOKEN,
  createClient,
  createMemoryAuth,
  createSqliteAuth,
  mockTelegramOIDC,
  signInitData,
  signInWithTelegramOIDC,
  signWidgetData,
  type TelegramOIDCMock,
  type TestClient,
  telegramClaims,
} from "./testing/harness";

let telegramMock: TelegramOIDCMock;

beforeEach(async () => {
  telegramMock = await mockTelegramOIDC();
});

afterEach(() => {
  telegramMock.restore();
});

const oidc = () => ({ enabled: true, clientSecret: telegramMock.clientSecret });

async function signUp(client: TestClient, email = "ann@example.com") {
  const response = await client.post("/sign-up/email", {
    email,
    password: "correct-horse-battery",
    name: "Ann",
  });
  if (response.status !== 200) {
    throw new Error(`sign-up failed: ${response.status} ${response.text}`);
  }
}

describe("login CSRF: sign-in requests from untrusted origins", () => {
  // Better Auth turns its origin checks off under NODE_ENV=test; production
  // has them on.
  const productionChecks = { advanced: { disableOriginCheck: false } };

  const routes = [
    [
      "/telegram/signin",
      async () => await signWidgetData({ id: 42, first_name: "Mallory" }),
    ],
    [
      "/telegram/miniapp/signin",
      async () => ({
        initData: await signInitData({ id: 42, first_name: "Mallory" }),
      }),
    ],
  ] as const;

  // An attacker page submitting the attacker's own fresh Telegram data would
  // sign the victim's browser into the attacker's account. Better Auth's own
  // first-login endpoints (/sign-in/email) refuse these with 403.
  it.each(routes)(
    "%s refuses a browser request from another site",
    async (path, body) => {
      const { auth, db } = createMemoryAuth(
        { miniApp: { enabled: true } },
        productionChecks
      );

      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
            "sec-fetch-mode": "cors",
          },
          body: JSON.stringify(await body()),
        })
      );

      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("INVALID_ORIGIN");
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(db.user).toHaveLength(0);
    }
  );

  it.each(routes)(
    "%s still serves the app's own origin and server-side callers",
    async (path, body) => {
      const { auth } = createMemoryAuth(
        { miniApp: { enabled: true } },
        productionChecks
      );
      const post = async (headers: Record<string, string>) =>
        await auth.handler(
          new Request(`${BASE_URL}/api/auth${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(await body()),
          })
        );

      const sameOrigin = await post({
        origin: BASE_URL,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
      });
      // A backend (e.g. a bot server) forwarding the data has no Origin.
      const serverSide = await post({});

      expect(sameOrigin.status).toBe(200);
      expect(serverSide.status).toBe(200);
    }
  );
});

describe("account.accountLinking", () => {
  it("enabled: false refuses /telegram/link", async () => {
    const { client, db } = createMemoryAuth(
      {},
      {
        emailAndPassword: { enabled: true },
        account: { accountLinking: { enabled: false } },
      }
    );
    await signUp(client);

    const response = await client.post(
      "/telegram/link",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("LINKING_DISABLED");
    expect(db.account.map((account) => account.providerId)).toEqual([
      "credential",
    ]);
    expect(db.user[0]!.telegramId ?? null).toBeNull();
  });

  // Better Auth docs: with `disableImplicitLinking`, sign-ins that would link
  // to an existing user "are rejected ... instead of being silently linked",
  // while signed-in users "can still link providers explicitly".
  it("disableImplicitLinking still allows the explicit /telegram/link", async () => {
    const { client, db } = createMemoryAuth(
      {},
      {
        emailAndPassword: { enabled: true },
        account: { accountLinking: { disableImplicitLinking: true } },
      }
    );
    await signUp(client);

    const response = await client.post(
      "/telegram/link",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(200);
    expect(db.user[0]!.telegramId).toBe("42");
  });

  it.each([[{ enabled: false }], [{ disableImplicitLinking: true }]])(
    "%o: a Mini App sign-in does not link itself to the OIDC user with that Telegram id",
    async (accountLinking) => {
      const { client, db } = createMemoryAuth(
        { miniApp: { enabled: true }, oidc: oidc() },
        { account: { accountLinking } }
      );
      await signInWithTelegramOIDC(client, telegramMock);
      client.clearCookies();

      const response = await client.post("/telegram/miniapp/signin", {
        initData: await signInitData({ id: 8_306_595_751 }),
      });

      expect(response.status).toBe(401);
      expect(response.json.code).toBe("ACCOUNT_NOT_LINKED");
      expect(client.hasSession()).toBe(false);
      // Neither linked nor duplicated into a second user.
      expect(db.user).toHaveLength(1);
      expect(db.account.map((account) => account.providerId)).toEqual([
        "telegram-oidc",
      ]);
    }
  );

  it("disableImplicitLinking still signs returning and new Telegram users in", async () => {
    const { client, db } = createMemoryAuth(
      {},
      { account: { accountLinking: { disableImplicitLinking: true } } }
    );
    const first = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );
    client.clearCookies();
    const again = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );

    expect([first.status, again.status]).toEqual([200, 200]);
    expect(db.user).toHaveLength(1);
  });
});

describe("session.cookieCache", () => {
  const cached = {
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
  };

  it("serves the linked Telegram id right after /telegram/link and drops it after /telegram/unlink", async () => {
    const { client } = createMemoryAuth({}, cached);
    await signUp(client);

    await client.post("/telegram/link", await signWidgetData({ id: 42 }));
    const linked = await client.get("/get-session");
    await client.post("/telegram/unlink", {});
    const unlinked = await client.get("/get-session");

    expect(linked.json.user.telegramId).toBe("42");
    expect(unlinked.json.user.telegramId ?? null).toBeNull();
  });
});

describe("custom table and column names", () => {
  it("signs in with the Login Widget and OIDC on renamed models and fields", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const options = {
      baseURL: BASE_URL,
      secret: "better-auth-telegram-test-secret-0123456789abcdef",
      logger: { disabled: true },
      database: sqlite,
      user: { modelName: "users", fields: { email: "email_address" } },
      account: { modelName: "accounts", fields: { accountId: "account_id" } },
      session: { modelName: "sessions", fields: { userId: "user_id" } },
      plugins: [
        telegram({
          botToken: BOT_TOKEN,
          botUsername: "test_bot",
          oidc: oidc(),
        }),
      ],
    };
    const { runMigrations } = await getMigrations(options);
    await runMigrations();
    const client = createClient(betterAuth(options));

    const widget = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );
    client.clearCookies();
    const again = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );
    client.clearCookies();
    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ id: "43" })
    );

    expect([widget.status, again.status, location]).toEqual([
      200,
      200,
      "/dashboard",
    ]);
    const rows = (sql: string) => sqlite.prepare(sql).all();
    expect(
      rows(
        'select email_address, "telegramId" from users order by email_address'
      )
    ).toEqual([
      {
        email_address: "12224742808376279442@telegram-oidc.placeholder.invalid",
        telegramId: "43",
      },
      { email_address: "42@telegram.placeholder.invalid", telegramId: "42" },
    ]);
    expect(
      rows('select account_id, "providerId" from accounts order by account_id')
    ).toEqual([
      { account_id: "12224742808376279442", providerId: "telegram-oidc" },
      { account_id: "42", providerId: "telegram" },
    ]);
  });
});

describe('advanced.database.generateId: "serial" (numeric ids)', () => {
  const serial = {
    emailAndPassword: { enabled: true },
    advanced: { database: { generateId: "serial" as const } },
  };

  it("tells the user's own Telegram account from another user's when linking", async () => {
    const { auth, client } = await createSqliteAuth({}, serial);
    await client.post("/telegram/signin", await signWidgetData({ id: 42 }));
    const other = createClient(auth);
    await signUp(other);

    const self = await client.post(
      "/telegram/link",
      await signWidgetData({ id: 42 })
    );
    const foreign = await other.post(
      "/telegram/link",
      await signWidgetData({ id: 42 })
    );

    expect(self.json.code).toBe("TELEGRAM_ALREADY_LINKED_SELF");
    expect(foreign.json.code).toBe("TELEGRAM_ALREADY_LINKED_OTHER");
  });

  it("lets an OIDC user whose Telegram id was copied link the Login Widget", async () => {
    const { client, rows } = await createSqliteAuth({ oidc: oidc() }, serial);
    await signInWithTelegramOIDC(client, telegramMock);

    const response = await client.post(
      "/telegram/link",
      await signWidgetData({ id: 8_306_595_751 })
    );

    expect(response.status).toBe(200);
    expect(rows("account").map((account) => account.providerId)).toEqual([
      "telegram-oidc",
      "telegram",
    ]);
  });
});

// Better Auth filters its own sign-in responses through parseUserOutput /
// parseSessionOutput (api/routes/sign-in.mjs), hiding `returned: false`.
describe("fields marked returned: false", () => {
  const hidden = {
    user: {
      additionalFields: {
        secretNote: {
          type: "string",
          required: false,
          defaultValue: "s3cret",
          returned: false,
        },
      },
    },
    session: {
      additionalFields: {
        deviceSecret: {
          type: "string",
          required: false,
          defaultValue: "d3vice",
          returned: false,
        },
      },
    },
  } as const;

  it.each([
    ["/telegram/signin", async () => await signWidgetData({ id: 42 })],
    [
      "/telegram/miniapp/signin",
      async () => ({ initData: await signInitData({ id: 42 }) }),
    ],
  ] as const)("stay out of the %s response", async (path, body) => {
    const { client, db } = createMemoryAuth(
      { miniApp: { enabled: true } },
      hidden as any
    );

    const response = await client.post(path, await body());

    expect(response.status).toBe(200);
    expect(db.user[0]!.secretNote).toBe("s3cret");
    expect(response.text).not.toContain("s3cret");
    expect(response.text).not.toContain("d3vice");
    expect(response.json.user.telegramId).toBe("42");
    expect(response.json.session.token).toBeTypeOf("string");
  });
});

describe("admin plugin", () => {
  it("keeps banned users out of the Login Widget, the Mini App and OIDC", async () => {
    const { client, db } = createMemoryAuth(
      { miniApp: { enabled: true }, oidc: oidc() },
      { plugins: [admin()] }
    );
    await signInWithTelegramOIDC(client, telegramMock);
    await client.post(
      "/telegram/link",
      await signWidgetData({ id: 8_306_595_751 })
    );
    client.clearCookies();
    db.user[0]!.banned = true;
    const sessionsBefore = db.session.length;

    const widget = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 8_306_595_751 })
    );
    const miniApp = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 8_306_595_751 }),
    });
    const { location } = await signInWithTelegramOIDC(client, telegramMock);

    expect([widget.status, widget.json.code]).toEqual([403, "BANNED_USER"]);
    expect([miniApp.status, miniApp.json.code]).toEqual([403, "BANNED_USER"]);
    expect(location).toContain("error=BANNED_USER");
    expect(client.hasSession()).toBe(false);
    expect(db.session).toHaveLength(sessionsBefore);
  });
});

// docs/miniapps.md recommends it where third-party cookies don't work
// (Mini Apps in Telegram Web's iframe).
describe("bearer plugin", () => {
  it("hands out the session token on Telegram sign-ins, and accepts it back", async () => {
    const { auth } = createMemoryAuth(
      { miniApp: { enabled: true } },
      { plugins: [bearer()] }
    );
    const signIn = await auth.handler(
      new Request(`${BASE_URL}/api/auth/telegram/miniapp/signin`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify({ initData: await signInitData({ id: 42 }) }),
      })
    );
    const token = signIn.headers.get("set-auth-token");

    const session = await auth.handler(
      new Request(`${BASE_URL}/api/auth/get-session`, {
        headers: { authorization: `Bearer ${token}` },
      })
    );

    expect(token).toBeTruthy();
    expect((await session.json()).user.telegramId).toBe("42");
  });
});

describe("multi-session plugin", () => {
  it("adds each Telegram sign-in to the device's sessions", async () => {
    const { client } = createMemoryAuth({}, { plugins: [multiSession()] });

    await client.post("/telegram/signin", await signWidgetData({ id: 1 }));
    await client.post("/telegram/signin", await signWidgetData({ id: 2 }));
    const sessions = await client.get("/multi-session/list-device-sessions");

    expect(
      sessions.json.map((session: any) => session.user.telegramId).sort()
    ).toEqual(["1", "2"]);
  });
});
