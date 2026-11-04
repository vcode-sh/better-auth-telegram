// @vitest-environment node
/**
 * Telegram OIDC against a real Better Auth instance and a fake
 * oauth.telegram.org (see src/testing/harness.ts).
 */
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  baseOptions,
  createClient,
  createMemoryAuth,
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

const linkingOptions = {
  emailAndPassword: { enabled: true },
  account: {
    accountLinking: {
      allowDifferentEmails: true,
      trustedProviders: ["telegram-oidc"],
    },
  },
};

async function signUp(client: TestClient) {
  const response = await client.post("/sign-up/email", {
    email: "ann@example.com",
    password: "correct-horse-battery",
    name: "Ann",
  });
  if (response.status !== 200) {
    throw new Error(`sign-up failed: ${response.status} ${response.text}`);
  }
}

const oidc = () => ({
  oidc: { enabled: true, clientSecret: telegramMock.clientSecret },
});

describe("Telegram identity on OIDC users", () => {
  it("stores the numeric Telegram id, username and phone on the user", async () => {
    const { client, db } = createMemoryAuth(oidc());

    await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({
        phone_number: "48572068680",
        phone_number_verified: true,
      })
    );

    expect(db.user[0]).toMatchObject({
      telegramId: "8306595751",
      telegramUsername: "ann",
      telegramPhoneNumber: "48572068680",
    });
  });

  it("keeps the stored username in sync on later sign-ins", async () => {
    const { client, db } = createMemoryAuth(oidc());

    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();
    await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ preferred_username: "ann_renamed" })
    );

    expect(db.user[0]!.telegramUsername).toBe("ann_renamed");
  });

  // The Login Widget clears it too; a stale username could be shown or
  // trusted as the user's handle after someone else takes it.
  it("clears the stored username once the Telegram user has none", async () => {
    const { client, db } = createMemoryAuth(oidc());
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();

    await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ preferred_username: undefined })
    );

    expect(db.user[0]!.telegramUsername ?? null).toBeNull();
    expect(db.account[0]!.telegramUsername ?? null).toBeNull();
  });

  it("keeps the username when the token carries no profile claims at all", async () => {
    const { client, db } = createMemoryAuth(oidc());
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();

    // `openid` only (or an EdDSA / ES256K bot): nothing is known about the
    // username, so nothing is cleared.
    await signInWithTelegramOIDC(client, telegramMock, {
      sub: "12224742808376279442",
    });

    expect(db.user[0]!.telegramUsername).toBe("ann");
  });

  // `phone_number` only comes with the `phone` scope and the user's consent
  // in a separate Telegram dialog: its absence is not a removed number.
  it("keeps the stored phone number when a later token has none", async () => {
    const { client, db } = createMemoryAuth(oidc());
    await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ phone_number: "48572068680" })
    );
    client.clearCookies();

    await signInWithTelegramOIDC(client, telegramMock);

    expect(db.user[0]!.telegramPhoneNumber).toBe("48572068680");
  });

  // Telegram's docs show `"id": 987654321` (a number); live tokens carry a
  // string. Both must land as the same string the Login Widget uses.
  it("stores the documented numeric id claim as a string", async () => {
    const { client, db } = createMemoryAuth({
      ...oidc(),
      miniApp: { enabled: true },
    });
    await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ id: 987_654_321 })
    );
    client.clearCookies();

    const miniApp = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 987_654_321 }),
    });

    expect(db.user[0]!.telegramId).toBe("987654321");
    expect(miniApp.status).toBe(200);
    expect(db.user).toHaveLength(1);
  });

  it("lets a Mini App sign-in find the user OIDC created", async () => {
    const { client, db } = createMemoryAuth({
      ...oidc(),
      miniApp: { enabled: true },
    });
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 8_306_595_751 }),
    });

    expect(response.status).toBe(200);
    expect(db.user).toHaveLength(1);
    expect(response.json.user.id).toBe(db.user[0]!.id);
  });

  it("signs an existing Widget user in through the same Telegram OIDC identity", async () => {
    const { client, db } = createMemoryAuth(oidc());
    await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 8_306_595_751 })
    );
    client.clearCookies();

    const result = await signInWithTelegramOIDC(client, telegramMock);
    expect(result.location, result.callback.text).toBe("/dashboard");

    const owners = db.user.filter((user) => user.telegramId === "8306595751");
    expect(owners).toHaveLength(1);
    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(2);
    expect(new Set(db.account.map((account) => account.userId)).size).toBe(1);
  });

  it("links OIDC to a signed-in user and copies the Telegram id", async () => {
    const { client, db } = createMemoryAuth(oidc(), linkingOptions);
    await signUp(client);

    const link = await client.post("/link-social", {
      provider: "telegram-oidc",
      callbackURL: "/settings",
    });
    const callback = await client.get(
      telegramMock.authorize(link.json.url, telegramClaims())
    );

    expect(callback.headers.get("location")).toBe("/settings");
    expect(db.user).toHaveLength(1);
    expect(db.user[0]!.telegramId).toBe("8306595751");
  });

  it("leaves the Telegram id alone when OIDC proves a different Telegram user", async () => {
    const { client, db } = createMemoryAuth(oidc(), linkingOptions);
    await client.post("/telegram/signin", await signWidgetData({ id: 42 }));

    const link = await client.post("/link-social", {
      provider: "telegram-oidc",
      callbackURL: "/settings",
    });
    await client.get(telegramMock.authorize(link.json.url, telegramClaims()));

    expect(db.account.map((account) => account.providerId).sort()).toEqual([
      "telegram",
      "telegram-oidc",
    ]);
    expect(db.user[0]!.telegramId).toBe("42");
  });
});

describe("the session issued by an OIDC sign-in", () => {
  const cookieCache = {
    session: { cookieCache: { enabled: true, maxAge: 300 } },
  };

  it("carries the Telegram identity of a new user", async () => {
    const { client } = createMemoryAuth(
      { oidc: { ...oidc().oidc, requestPhone: true } },
      cookieCache
    );

    await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ phone_number: "48572068680" })
    );
    const session = await client.get("/get-session");

    expect(session.json.user).toMatchObject({
      telegramId: "8306595751",
      telegramUsername: "ann",
      telegramPhoneNumber: "48572068680",
    });
  });

  // No database: the cookie is the session, there is nothing to refresh from.
  it("carries the Telegram identity in stateless mode", async () => {
    const auth = betterAuth(baseOptions(oidc(), {}));
    const client = createClient(auth);

    await signInWithTelegramOIDC(client, telegramMock);
    const session = await client.get("/get-session");

    expect(session.json.user.telegramId).toBe("8306595751");
  });

  it("carries a username that changed since the last sign-in", async () => {
    const { client } = createMemoryAuth(oidc(), cookieCache);
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();

    await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ preferred_username: "ann_renamed" })
    );
    const session = await client.get("/get-session");

    expect(session.json.user.telegramUsername).toBe("ann_renamed");
  });

  it("answers a client-submitted ID token with the Telegram identity", async () => {
    const { client } = createMemoryAuth(oidc(), cookieCache);
    const token = await telegramMock.sign({
      ...telegramClaims(),
      nonce: "n-1",
    });

    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token, nonce: "n-1" },
    });
    const session = await client.get("/get-session");

    expect(response.json.user.telegramId).toBe("8306595751");
    expect(session.json.user.telegramId).toBe("8306595751");
  });

  it("carries the identity when the first sign-in links a user by email", async () => {
    const { client, db } = createMemoryAuth(
      {
        oidc: {
          ...oidc().oidc,
          mapOIDCProfileToUser: () => ({ email: "ann@example.com" }),
        },
      },
      { ...linkingOptions, ...cookieCache }
    );
    await signUp(client);
    db.user[0]!.emailVerified = true;
    client.clearCookies();

    const { location } = await signInWithTelegramOIDC(client, telegramMock);
    const session = await client.get("/get-session");

    expect(location).toBe("/dashboard");
    expect(session.json.user.telegramId).toBe("8306595751");
  });

  it("sends the session cookies once", async () => {
    const { client } = createMemoryAuth(oidc(), cookieCache);

    const { callback } = await signInWithTelegramOIDC(client, telegramMock);
    const names = callback.headers
      .getSetCookie()
      .map((cookie) => cookie.slice(0, cookie.indexOf("=")));

    expect(names.filter((name) => name.includes("session_data"))).toHaveLength(
      1
    );
    expect(names.filter((name) => name.includes("session_token"))).toHaveLength(
      1
    );
  });

  // An app's after hook may end the session it was just given.
  it("does not bring back a session cookie an earlier hook removed", async () => {
    const { client } = createMemoryAuth(oidc(), {
      ...cookieCache,
      hooks: {
        after: createAuthMiddleware((ctx) => {
          if (ctx.path.startsWith("/callback/") && ctx.context.newSession) {
            deleteSessionCookie(ctx);
          }
          return Promise.resolve();
        }),
      },
    });

    await signInWithTelegramOIDC(client, telegramMock);

    expect(client.hasSession()).toBe(false);
  });

  it("issues the cached OIDC session for the existing Telegram user", async () => {
    const { client, db } = createMemoryAuth(oidc(), cookieCache);
    await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 8_306_595_751 })
    );
    client.clearCookies();

    await signInWithTelegramOIDC(client, telegramMock);
    const session = await client.get("/get-session");

    expect(db.user).toHaveLength(1);
    expect(session.json.user.id).toBe(db.user[0]!.id);
    expect(session.json.user.telegramId).toBe("8306595751");
  });
});

// #53: the mapper's values only land on new users unless the app opts in.
