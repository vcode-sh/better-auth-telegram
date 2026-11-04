// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_ID,
  createClient,
  createMemoryAuth,
  createSqliteAuth,
  mockTelegramOIDC,
  signInWithTelegramOIDC,
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
