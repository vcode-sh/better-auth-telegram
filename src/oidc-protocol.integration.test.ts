// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_ID,
  createMemoryAuth,
  mockTelegramOIDC,
  signInWithTelegramOIDC,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";

let telegramMock: TelegramOIDCMock;

beforeEach(async () => {
  telegramMock = await mockTelegramOIDC();
});

afterEach(() => {
  telegramMock.restore();
});

const oidc = () => ({
  oidc: { enabled: true, clientSecret: telegramMock.clientSecret },
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

// Better Auth issues the session (and its cookie cache, `newSession`, the ID
// token sign-in response) with the user it read before the session existed.
// Catches: Telegram fields written after that read, which a cookie cache
// keeps serving stale until `maxAge` — and in stateless mode until the next
// sign-in.
