// @vitest-environment node
/**
 * Telegram OIDC against a real Better Auth instance and a fake
 * oauth.telegram.org (see src/testing/harness.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_ID,
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

  it("signs the same Telegram user back into the same account", async () => {
    const { client, db } = createMemoryAuth({ loginWidget: false, ...oidc() });

    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();
    await signInWithTelegramOIDC(client, telegramMock);

    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(1);
  });

  // Catches: the option not reaching Better Auth, and the placeholder-email
  // guard refusing the owner's own placeholder when Better Auth writes the
  // profile back (sign-in fails, or the refresh is silently dropped).
  it("refreshes a changed Telegram name and photo with overrideUserInfoOnSignIn", async () => {
    const { client, db } = createMemoryAuth({
      loginWidget: false,
      oidc: {
        ...oidc().oidc,
        overrideUserInfoOnSignIn: true,
      },
    });

    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();
    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({
        name: "Ann Renamed",
        picture: "https://t.me/i/userpic/320/new.jpg",
      })
    );

    expect(location).toBe("/dashboard");
    expect(db.user).toHaveLength(1);
    expect(db.user[0]).toMatchObject({
      name: "Ann Renamed",
      image: "https://t.me/i/userpic/320/new.jpg",
      email: "12224742808376279442@telegram-oidc.placeholder.invalid",
    });
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
    ["openid even when custom scopes omit it", { scopes: [] }, {}, ["openid"]],
    [
      "each scope once",
      { scopes: ["openid", "phone"], requestPhone: true },
      {},
      ["openid", "phone"],
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
