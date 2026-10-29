// @vitest-environment node
/**
 * Telegram OIDC against a real Better Auth instance and a fake
 * oauth.telegram.org (see src/testing/harness.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_ID,
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

describe("Telegram OIDC sign-in (authorization code flow)", () => {
  it("creates a user, an account keyed by sub, and a session", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    const { location } = await signInWithTelegramOIDC(client, telegramMock);

    expect(location).toBe("/dashboard");
    expect(client.hasSession()).toBe(true);
    expect(db.account).toHaveLength(1);
    expect(db.account[0]).toMatchObject({
      providerId: "telegram-oidc",
      accountId: "12224742808376279442",
    });
    expect(db.user[0]).toMatchObject({
      name: "Ann Example",
      image: "https://t.me/i/userpic/320/ann.jpg",
      emailVerified: false,
    });
  });

  it("gives users a non-routable placeholder email derived from sub", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    await signInWithTelegramOIDC(client, telegramMock);

    expect(db.user[0]!.email).toBe(
      "12224742808376279442@telegram-oidc.placeholder.invalid"
    );
  });

  it.each([{ trustedProviders: [] }, { trustedProviders: ["telegram-oidc"] }])(
    "creates a new OIDC user after unlinking, with $trustedProviders trusted",
    async ({ trustedProviders }) => {
      const { client, db } = createMemoryAuth(
        { loginWidget: false, ...oidc() },
        {
          account: {
            accountLinking: {
              allowUnlinkingAll: true,
              trustedProviders,
              requireLocalEmailVerified: false,
            },
          },
        }
      );
      await signInWithTelegramOIDC(client, telegramMock);
      const oldUserId = db.user[0]!.id;
      const unlink = await client.post("/unlink-account", {
        accountId: db.account[0]!.id,
      });
      expect(unlink.status).toBe(200);
      client.clearCookies();

      const { location } = await signInWithTelegramOIDC(client, telegramMock);

      expect(location).toBe("/dashboard");
      expect(db.user).toHaveLength(2);
      expect(db.account[0]!.userId).not.toBe(oldUserId);
      expect(db.user[1]!.email).toMatch(
        /^12224742808376279442\.[\w-]+@telegram-oidc\.placeholder\.invalid$/u
      );
    }
  );

  it("works on a SQL database with the schema Better Auth generates", async () => {
    const { client, rows } = await createSqliteAuth(oidc());

    const { location } = await signInWithTelegramOIDC(client, telegramMock);

    expect(location).toBe("/dashboard");
    expect(rows("account")).toHaveLength(1);
  });

  it("authenticates to the token endpoint with HTTP Basic, not the body", async () => {
    const { client } = createMemoryAuth({ loginWidget: false, ...oidc() });

    await signInWithTelegramOIDC(client, telegramMock);

    const [tokenRequest] = telegramMock.tokenRequests;
    expect(tokenRequest!.authorization).toBe(
      `Basic ${Buffer.from(`${BOT_ID}:${telegramMock.clientSecret}`).toString("base64")}`
    );
    expect(tokenRequest!.body.has("client_secret")).toBe(false);
  });

  it("sends a nonce and rejects an ID token that does not echo it", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    const { start, location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims(),
      {},
      { nonce: "attacker-chosen-nonce" }
    );

    expect(new URL(start.json.url).searchParams.get("nonce")).toBeTruthy();
    expect(location).toContain("error=unable_to_get_user_info");
    expect(db.user).toHaveLength(0);
    expect(client.hasSession()).toBe(false);
  });

  it("rejects an ID token that is not signed by Telegram's keys", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims(),
      {},
      { forge: true }
    );

    expect(location).toContain("error=unable_to_get_user_info");
    expect(db.user).toHaveLength(0);
  });

  // Catches: a user created or signed in from a token response that carries
  // no ID token (nothing verified, so no claim may be trusted).
  it("refuses a token response without an ID token", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims(),
      {},
      { omitIdToken: true }
    );

    expect(location).toContain("error=unable_to_get_user_info");
    expect(db.user).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  it("reports Telegram token errors (sent as HTTP 200) as an invalid code", async () => {
    const { client, db } = createMemoryAuth({
      loginWidget: false,
      oidc: { enabled: true, clientSecret: "wrong-secret" },
    });

    const { location } = await signInWithTelegramOIDC(client, telegramMock);

    expect(location).toContain("error=invalid_code");
    expect(db.user).toHaveLength(0);
  });

  it("reuses the cached JWKS across sign-ins", async () => {
    const { client } = createMemoryAuth({ loginWidget: false, ...oidc() });

    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();
    await signInWithTelegramOIDC(client, telegramMock);

    expect(telegramMock.jwksRequests).toBe(1);
  });

  // jose refetches the key set for an unknown kid, at most once per 30 s
  // (createRemoteJWKSet's default cooldownDuration).
  it("picks up a rotated Telegram signing key once the 30 s refetch cooldown has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_761_730_000_000);
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();
    await telegramMock.rotateKey();

    const tooSoon = await signInWithTelegramOIDC(client, telegramMock);
    vi.setSystemTime(1_761_730_031_000);
    const later = await signInWithTelegramOIDC(client, telegramMock);

    expect(tooSoon.location).toContain("error=unable_to_get_user_info");
    expect(later.location).toBe("/dashboard");
    expect(telegramMock.jwksRequests).toBe(2);
    expect(db.user).toHaveLength(1);
    vi.useRealTimers();
  });

  it("fails the sign-in without a user while Telegram's JWKS is down, and recovers", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });
    telegramMock.setJwksStatus(503);

    const down = await signInWithTelegramOIDC(client, telegramMock);
    telegramMock.setJwksStatus(200);
    const up = await signInWithTelegramOIDC(client, telegramMock);

    expect(down.location).toContain("error=unable_to_get_user_info");
    expect(up.location).toBe("/dashboard");
    expect(db.user).toHaveLength(1);
  });

  // Defensive coverage of the generic OAuth error path (RFC 6749 §4.1.2.1)
  // only: measured live on 2026-10-29, declining in the Telegram app sends no
  // callback at all, and oauth.telegram.org shows its account picker again.
  it("sends an OAuth error callback to errorCallbackURL, creating nothing", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });
    const start = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      callbackURL: "/dashboard",
      errorCallbackURL: "/login-failed",
    });
    const state = new URL(start.json.url).searchParams.get("state");

    const callback = await client.get(
      `/callback/telegram-oidc?error=access_denied&state=${state}`
    );

    expect(callback.headers.get("location")).toBe(
      "/login-failed?error=access_denied"
    );
    expect(telegramMock.tokenRequests).toHaveLength(0);
    expect(db.user).toHaveLength(0);
    expect(client.hasSession()).toBe(false);
  });

  it("signs the same Telegram user back into the same account", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();
    await signInWithTelegramOIDC(client, telegramMock);

    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(1);
  });

  it("redirects duplicate OIDC identities to an error without creating a session", async () => {
    const { client, db } = createMemoryAuth(oidc());
    await signInWithTelegramOIDC(client, telegramMock);
    db.account.push({ ...db.account[0]!, id: "duplicate-oidc-account" });
    client.clearCookies();
    const sessionCount = db.session.length;

    const { callback, location } = await signInWithTelegramOIDC(
      client,
      telegramMock
    );

    expect(callback.status).toBe(302);
    expect(location).toContain("error=internal_server_error");
    expect(client.hasSession()).toBe(false);
    expect(db.session).toHaveLength(sessionCount);
    expect(db.user).toHaveLength(1);
  });

  it.each([
    { model: "account" as const, returning: false },
    { model: "user" as const, returning: false },
    { model: "account" as const, returning: true },
    { model: "user" as const, returning: true },
  ])(
    "rejects OIDC when $model identity sync is vetoed (returning: $returning)",
    async ({ model, returning }) => {
      const before = vi.fn(async (): Promise<false | undefined> => undefined);
      const { client, db } = createMemoryAuth(oidc(), {
        databaseHooks: {
          [model]: {
            update: {
              before: (data: Record<string, unknown>) =>
                "telegramId" in data || "telegramUsername" in data
                  ? before()
                  : undefined,
            },
          },
        },
      });
      if (returning) {
        await signInWithTelegramOIDC(client, telegramMock);
        client.clearCookies();
      }
      const sessionCount = db.session.length;
      before.mockResolvedValue(false);

      const { location } = await signInWithTelegramOIDC(
        client,
        telegramMock,
        telegramClaims({ preferred_username: "changed" })
      );

      expect(location).toContain("error=IDENTITY_UPDATE_REJECTED");
      expect(client.hasSession()).toBe(false);
      expect(db.session).toHaveLength(sessionCount);
    }
  );

  it("rolls back OIDC identity fields when a user update is vetoed on SQL", async () => {
    const { client, rows, sqlite } = await createSqliteAuth(oidc(), {
      databaseHooks: { user: { update: { before: async () => false } } },
    });
    try {
      const { location } = await signInWithTelegramOIDC(client, telegramMock);

      expect(location).toContain("error=IDENTITY_UPDATE_REJECTED");
      expect(rows("account")[0]!.telegramId).toBeNull();
      expect(rows("user")[0]!.telegramId).toBeNull();
      expect(rows("session")).toHaveLength(0);
      expect(client.hasSession()).toBe(false);
    } finally {
      sqlite.close();
    }
  });

  // An app may let Telegram users add a real email (password login, magic
  // links). Better Auth's `overrideUserInfoOnSignIn` writes the provider's
  // email back on every redirect-flow sign-in (callback.mjs, the only route
  // that reads it; link-account.mjs), which would replace it with the
  // placeholder. The plugin never passes that option on, even when a 3.0
  // beta configuration still carries it.
  it.each([
    ["default options", {}],
    ["the removed beta option", { overrideUserInfoOnSignIn: true }],
  ])(
    "keeps a real verified email across OIDC sign-ins (%s)",
    async (_label, extra) => {
      const { client, db } = createMemoryAuth({
        loginWidget: false,
        oidc: { ...oidc().oidc, ...(extra as object) },
      });
      await signInWithTelegramOIDC(client, telegramMock);
      db.user[0]!.email = "ann@example.com";
      db.user[0]!.emailVerified = true;
      client.clearCookies();

      const { location } = await signInWithTelegramOIDC(
        client,
        telegramMock,
        telegramClaims({ name: "Ann Renamed" })
      );

      expect(location).toBe("/dashboard");
      expect(db.user).toHaveLength(1);
      expect(db.user[0]).toMatchObject({
        email: "ann@example.com",
        emailVerified: true,
      });
    }
  );

  // Catches: mapOIDCProfileToUser vouching for an email Telegram never
  // verified. Better Auth links implicitly on emailVerified, so the
  // Telegram user would take over the existing account.
  it("does not let mapOIDCProfileToUser mark an email verified", async () => {
    const { auth, db } = createMemoryAuth(
      {
        loginWidget: false,
        oidc: {
          ...oidc().oidc,
          mapOIDCProfileToUser: () => ({
            email: "ann@example.com",
            emailVerified: true,
          }),
        },
      },
      { emailAndPassword: { enabled: true } }
    );
    const victim = createClient(auth);
    await signUp(victim);
    db.user[0]!.emailVerified = true;
    const attacker = createClient(auth);

    const { location } = await signInWithTelegramOIDC(attacker, telegramMock);

    expect(location).not.toBe("/dashboard");
    expect(
      db.account.filter((account) => account.providerId === "telegram-oidc")
    ).toHaveLength(0);
  });

  it("signs in with an ID token that has only sub (EdDSA / ES256K bots drop profile claims)", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    const { location } = await signInWithTelegramOIDC(client, telegramMock, {
      sub: "12224742808376279442",
    });

    expect(location).toBe("/dashboard");
    expect(db.account[0]!.accountId).toBe("12224742808376279442");
  });
});

describe("Telegram OIDC sign-in with a client-submitted ID token", () => {
  it("accepts a token signed by Telegram", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });
    const token = await telegramMock.sign({
      ...telegramClaims(),
      nonce: "n-1",
    });

    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token, nonce: "n-1" },
    });

    expect(response.status).toBe(200);
    expect(response.json.token).toBeTruthy();
    expect(db.account[0]!.accountId).toBe("12224742808376279442");
  });

  it("rejects a token signed with a key that is not in Telegram's JWKS", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });
    const forger = await mockTelegramOIDC();
    // The nonce matches, so only the signature check can refuse it.
    const token = await forger.sign({ ...telegramClaims(), nonce: "n-1" });
    forger.restore();
    telegramMock.restore();
    telegramMock = await mockTelegramOIDC();

    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token, nonce: "n-1" },
    });

    expect(response.status).toBe(401);
    expect(db.user).toHaveLength(0);
  });

  it("rejects a token whose nonce does not match", async () => {
    const { client } = createMemoryAuth({ loginWidget: false, ...oidc() });
    const token = await telegramMock.sign({ ...telegramClaims(), nonce: "a" });

    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token, nonce: "b" },
    });

    expect(response.status).toBe(401);
  });
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

  it("does not copy a Telegram id that another user already owns", async () => {
    const { client, db } = createMemoryAuth(oidc());
    await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 8_306_595_751 })
    );
    client.clearCookies();

    await signInWithTelegramOIDC(client, telegramMock);

    const owners = db.user.filter((user) => user.telegramId === "8306595751");
    expect(owners).toHaveLength(1);
    expect(db.user).toHaveLength(2);
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

describe("the authorization request sent to Telegram", () => {
  async function authorizationURL(
    oidcOptions: Record<string, unknown> = {},
    body: Record<string, unknown> = {}
  ) {
    const { client } = createMemoryAuth({
      loginWidget: false,
      oidc: {
        enabled: true,
        clientSecret: telegramMock.clientSecret,
        ...oidcOptions,
      },
    });
    const start = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      callbackURL: "/dashboard",
      ...body,
    });
    if (start.status !== 200) {
      throw new Error(`sign-in/social failed: ${start.status} ${start.text}`);
    }
    return new URL(start.json.url);
  }

  it("is a code request with PKCE S256 and a nonce, and no legacy widget parameters (#12)", async () => {
    const url = await authorizationURL();

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://oauth.telegram.org/auth"
    );
    expect([...url.searchParams.keys()].sort()).toEqual([
      "client_id",
      "code_challenge",
      "code_challenge_method",
      "nonce",
      "redirect_uri",
      "response_type",
      "scope",
      "state",
    ]);
    expect(url.searchParams.get("response_type")).toBe("code");
    // The default client id is the bot id, the part of the token before ":".
    expect(url.searchParams.get("client_id")).toBe("123456789");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/callback/telegram-oidc"
    );
  });

  it.each([
    ["openid and profile by default", {}, {}, ["openid", "profile"]],
    [
      "phone with requestPhone",
      { requestPhone: true },
      {},
      ["openid", "phone", "profile"],
    ],
    [
      "telegram:bot_access with requestBotAccess",
      { requestBotAccess: true },
      {},
      ["openid", "profile", "telegram:bot_access"],
    ],
    [
      "the scopes passed to the sign-in request",
      {},
      { scopes: ["telegram:bot_access"] },
      ["openid", "profile", "telegram:bot_access"],
    ],
    // Like Better Auth's own providers, `scopes` adds to the defaults and
    // `disableDefaultScope` removes them (core social-providers/google.mjs).
    [
      "profile on top of custom scopes",
      { scopes: ["phone"] },
      {},
      ["openid", "phone", "profile"],
    ],
    [
      "only openid with disableDefaultScope",
      { disableDefaultScope: true },
      {},
      ["openid"],
    ],
    [
      "each scope once, also from the sign-in request",
      { scopes: ["openid", "phone"], requestPhone: true },
      { scopes: ["profile", "phone"] },
      ["openid", "phone", "profile"],
    ],
  ])("asks for %s", async (_case, oidcOptions, body, expected) => {
    const url = await authorizationURL(oidcOptions, body);

    expect(url.searchParams.get("scope")!.split(" ").sort()).toEqual(expected);
  });
});

describe("ID token checks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects an ID token from another issuer", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ iss: "https://oauth.telegram.org.evil.example" })
    );

    expect(location).toContain("error=unable_to_get_user_info");
    expect(db.user).toHaveLength(0);
  });

  // OpenID Connect Core 1.0 §3.1.3.7: "The ID Token MUST be rejected if
  // [...] it contains additional audiences not trusted by the Client."
  it.each([
    [["123456789"], "/dashboard"],
    [["123456789", "987654321"], "error=unable_to_get_user_info"],
  ])("an ID token for audiences %j → %s", async (aud, outcome) => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ aud })
    );

    expect(location).toContain(outcome);
    expect(db.user).toHaveLength(outcome === "/dashboard" ? 1 : 0);
  });

  // Telegram's tokens expire 30 s after issue; 30 s of clock tolerance on top.
  it.each([
    [59, 200],
    [61, 401],
  ])("a token presented %i s after issue → %i", async (age, status) => {
    const { client } = createMemoryAuth({ loginWidget: false, ...oidc() });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_761_730_000_000);
    const token = await telegramMock.sign({ ...telegramClaims(), nonce: "n" });
    vi.setSystemTime(1_761_730_000_000 + age * 1000);

    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token, nonce: "n" },
    });

    expect(response.status).toBe(status);
  });
});

describe("a separate OIDC bot (oidc.clientId)", () => {
  const OIDC_BOT_ID = "987654321";

  beforeEach(async () => {
    telegramMock.restore();
    telegramMock = await mockTelegramOIDC({ clientId: OIDC_BOT_ID });
  });

  const twoBots = () => ({
    oidc: {
      enabled: true,
      clientId: OIDC_BOT_ID,
      clientSecret: telegramMock.clientSecret,
    },
  });

  it("authenticates to Telegram as that client, not as the Login Widget bot", async () => {
    const { client } = createMemoryAuth(twoBots());

    const { start, location } = await signInWithTelegramOIDC(
      client,
      telegramMock
    );

    expect(new URL(start.json.url).searchParams.get("client_id")).toBe(
      OIDC_BOT_ID
    );
    expect(location).toBe("/dashboard");
    expect(telegramMock.tokenRequests[0]!.authorization).toBe(
      `Basic ${Buffer.from(`${OIDC_BOT_ID}:${telegramMock.clientSecret}`).toString("base64")}`
    );
  });

  it("accepts only ID tokens issued to that client", async () => {
    const { client } = createMemoryAuth(twoBots());
    const signIn = async (aud: string) =>
      client.post("/sign-in/social", {
        provider: "telegram-oidc",
        idToken: {
          token: await telegramMock.sign({
            ...telegramClaims(),
            aud,
            nonce: "n",
          }),
          nonce: "n",
        },
      });

    expect((await signIn(BOT_ID)).status).toBe(401);
    expect((await signIn(OIDC_BOT_ID)).status).toBe(200);
  });
});

describe("missing OIDC credentials at request time", () => {
  it("answers 500 with a code that names the missing clientSecret", async () => {
    const { client } = createMemoryAuth({
      loginWidget: false,
      oidc: { enabled: true },
    });

    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      callbackURL: "/dashboard",
    });

    expect(response.status).toBe(500);
    expect(response.json).toMatchObject({
      code: "OIDC_CLIENT_SECRET_REQUIRED",
    });
    expect(response.json.message).toContain("clientSecret");
  });
});

describe("social provider registration", () => {
  it("keeps the app's other social providers next to Telegram OIDC", async () => {
    const { client } = createMemoryAuth(oidc(), {
      socialProviders: {
        github: { clientId: "github-client", clientSecret: "github-secret" },
      },
    });

    const github = await client.post("/sign-in/social", {
      provider: "github",
      callbackURL: "/dashboard",
    });
    const telegram = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      callbackURL: "/dashboard",
    });

    expect(github.status).toBe(200);
    expect(new URL(github.json.url).host).toBe("github.com");
    expect(new URL(telegram.json.url).host).toBe("oauth.telegram.org");
  });

  it("offers no Telegram OIDC sign-in unless oidc.enabled", async () => {
    const { client } = createMemoryAuth();

    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      callbackURL: "/dashboard",
    });

    expect(response.status).toBe(404);
  });
});
