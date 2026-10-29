// @vitest-environment node
/**
 * Lifecycle of the Telegram identity stored on the user (`telegramId`):
 * it must only ever be backed by a linked Telegram account, because the
 * Login Widget and Mini App sign users in by it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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

const TELEGRAM_ID = 8_306_595_751;

const options = (extra = {}) => ({
  oidc: { enabled: true, clientSecret: telegramMock.clientSecret },
  miniApp: { enabled: true },
  ...extra,
});

const authOptions = {
  emailAndPassword: { enabled: true },
  account: {
    accountLinking: {
      allowDifferentEmails: true,
      trustedProviders: ["telegram-oidc"],
    },
  },
};

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

async function linkOIDC(client: TestClient, claims = telegramClaims()) {
  const link = await client.post("/link-social", {
    provider: "telegram-oidc",
    callbackURL: "/settings",
  });
  return client.get(telegramMock.authorize(link.json.url, claims));
}

function accountId(db: { account: Record<string, any>[] }, providerId: string) {
  return db.account.find((account) => account.providerId === providerId)!.id;
}

describe("removing a Telegram account revokes the Telegram identity", () => {
  it("clears telegramId when the OIDC account is unlinked through Better Auth", async () => {
    const { client, db } = createMemoryAuth(options(), authOptions);
    await signUp(client);
    await linkOIDC(client);
    expect(db.user[0]!.telegramId).toBe("8306595751");

    const unlink = await client.post("/unlink-account", {
      accountId: accountId(db, "telegram-oidc"),
    });

    expect(unlink.status).toBe(200);
    expect(db.user[0]!.telegramId).toBeNull();
  });

  it("does not let the Mini App sign back in after the OIDC account is unlinked", async () => {
    const { auth, client, db } = createMemoryAuth(options(), authOptions);
    await signUp(client);
    await linkOIDC(client);
    await client.post("/unlink-account", {
      accountId: accountId(db, "telegram-oidc"),
    });

    const miniApp = createClient(auth);
    const response = await miniApp.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: TELEGRAM_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.json.user.id).not.toBe(db.user[0]!.id);
  });

  it("clears telegramId when the Login Widget account is unlinked through Better Auth", async () => {
    const { client, db } = createMemoryAuth(options(), authOptions);
    await signUp(client);
    await client.post("/telegram/link", await signWidgetData({ id: 42 }));

    await client.post("/unlink-account", {
      accountId: accountId(db, "telegram"),
    });

    expect(db.user[0]!.telegramId).toBeNull();
  });

  it("keeps telegramId while another account still proves the same Telegram user", async () => {
    const { client, db } = createMemoryAuth(options(), authOptions);
    await signUp(client);
    await linkOIDC(client);
    await client.post(
      "/telegram/link",
      await signWidgetData({ id: TELEGRAM_ID })
    );

    const response = await client.post("/telegram/unlink", {});

    expect(response.status).toBe(200);
    expect(db.user[0]!.telegramId).toBe("8306595751");
  });

  it("drops telegramId when the remaining OIDC account belongs to another Telegram user", async () => {
    const { client, db } = createMemoryAuth(options(), authOptions);
    await client.post("/telegram/signin", await signWidgetData({ id: 42 }));
    await linkOIDC(client);
    expect(db.user[0]!.telegramId).toBe("42");

    await client.post("/unlink-account", {
      accountId: accountId(db, "telegram"),
    });

    expect(db.user[0]!.telegramId).toBe("8306595751");
  });
});

describe("one Telegram user per account", () => {
  it("refuses to link a second, different Telegram account", async () => {
    const { client, db } = createMemoryAuth(options(), authOptions);
    await signUp(client);
    await client.post("/telegram/link", await signWidgetData({ id: 1 }));

    const response = await client.post(
      "/telegram/link",
      await signWidgetData({ id: 2 })
    );

    expect(response.status).toBe(409);
    expect(response.json.code).toBe("DIFFERENT_TELEGRAM_ACCOUNT_LINKED");
    expect(db.user[0]!.telegramId).toBe("1");
  });
});

describe("verified OIDC claims only apply to the user they prove", () => {
  it("does not copy them onto another user's session created in the same request", async () => {
    const state: { ann?: string; bob?: string; done: boolean } = {
      done: false,
    };
    const { auth, client, db } = createMemoryAuth(options(), {
      ...authOptions,
      databaseHooks: {
        session: {
          create: {
            // An app hook that starts a session for an unrelated user while
            // the OIDC callback request is still running.
            async after(session, context) {
              if (session.userId === state.ann && state.bob && !state.done) {
                state.done = true;
                await context!.context.internalAdapter.createSession(state.bob);
              }
            },
          },
        },
      },
    });
    // Ann: Login Widget (Telegram 42) plus an OIDC account for another
    // Telegram user, so her own telegramId stays 42.
    await client.post("/telegram/signin", await signWidgetData({ id: 42 }));
    await linkOIDC(client);
    state.ann = db.user[0]!.id;
    const bobClient = createClient(auth);
    await signUp(bobClient, "bob@example.com");
    state.bob = db.user.find((user) => user.email === "bob@example.com")!.id;
    client.clearCookies();

    await signInWithTelegramOIDC(client, telegramMock);

    expect(state.done).toBe(true);
    const bob = db.user.find((user) => user.id === state.bob)!;
    expect(bob.telegramId ?? null).toBeNull();
  });
});

describe("ID token sign-in", () => {
  it("requires the nonce the token was issued with", async () => {
    const { client } = createMemoryAuth(options());
    const token = await telegramMock.sign({
      ...telegramClaims(),
      nonce: "n-1",
    });

    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token },
    });

    expect(response.status).toBe(401);
  });

  it("can be turned off", async () => {
    const { client } = createMemoryAuth(
      options({
        oidc: {
          enabled: true,
          clientSecret: telegramMock.clientSecret,
          disableIdTokenSignIn: true,
        },
      })
    );
    const token = await telegramMock.sign({
      ...telegramClaims(),
      nonce: "n-1",
    });

    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token, nonce: "n-1" },
    });

    expect(response.status).toBe(404);
  });

  it("honors oidc.disableSignUp", async () => {
    const { client, db } = createMemoryAuth(
      options({
        oidc: {
          enabled: true,
          clientSecret: telegramMock.clientSecret,
          disableSignUp: true,
        },
      })
    );

    const { location } = await signInWithTelegramOIDC(client, telegramMock);

    expect(location).toContain("error=signup_disabled");
    expect(db.user).toHaveLength(0);
  });
});

describe("validateUserInfo beyond sign-up", () => {
  it("runs for returning Login Widget sign-ins", async () => {
    const validateUserInfo = vi.fn(
      async ({ source }: { source: { action: string } }) =>
        source.action === "sign-in" ? { error: "suspended" } : undefined
    );
    const { client } = createMemoryAuth({}, { user: { validateUserInfo } });
    await client.post("/telegram/signin", await signWidgetData({ id: 42 }));
    client.clearCookies();

    const response = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("suspended");
  });

  it("runs before /telegram/link links an account", async () => {
    const validateUserInfo = vi.fn(
      async ({ source }: { source: { action: string } }) =>
        source.action === "link-account" ? { error: "no_linking" } : undefined
    );
    const { client, db } = createMemoryAuth(
      {},
      { ...authOptions, user: { validateUserInfo } }
    );
    await signUp(client);

    const response = await client.post(
      "/telegram/link",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(403);
    expect(
      db.account.filter((account) => account.providerId === "telegram")
    ).toHaveLength(0);
  });
});

describe("validateUserInfo for an implicit link by telegramId", () => {
  it("sees a Mini App sign-in into an OIDC user as link-account by telegram-mini-app", async () => {
    const validateUserInfo = vi.fn(
      async ({ source }: { source: { action: string } }) =>
        source.action === "link-account" ? { error: "no_linking" } : undefined
    );
    const { client, db } = createMemoryAuth(options(), {
      user: { validateUserInfo },
    });
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: TELEGRAM_ID }),
    });

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("no_linking");
    expect(validateUserInfo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: { action: "link-account", method: "telegram-mini-app" },
      }),
      expect.anything()
    );
    expect(
      db.account.filter((account) => account.providerId === "telegram")
    ).toHaveLength(0);
  });
});

describe("failing closed", () => {
  it("rejects a sign-in when validateUserInfo throws", async () => {
    const { client } = createMemoryAuth(
      {},
      {
        user: {
          validateUserInfo: ({ source }: { source: { action: string } }) =>
            source.action === "sign-in"
              ? Promise.reject(new Error("policy service down"))
              : Promise.resolve(undefined),
        },
      }
    );
    await client.post("/telegram/signin", await signWidgetData({ id: 42 }));
    client.clearCookies();

    const response = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("validation_failed");
  });

  it("answers 403 when a database hook vetoes the Telegram sign-up", async () => {
    const { client, db } = createMemoryAuth(
      {},
      { databaseHooks: { user: { create: { before: async () => false } } } }
    );

    const response = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("USER_CREATION_REJECTED");
    expect(db.account).toHaveLength(0);
  });
});

describe("placeholder emails cannot be claimed by other sign-up methods", () => {
  // Otherwise anyone could pre-register a Telegram user's placeholder address
  // with a password and block (or take over) that user's Telegram sign-up.
  it.each([
    ["Login Widget / Mini App", "42@telegram.placeholder.invalid"],
    ["OIDC", "12224742808376279442@telegram-oidc.placeholder.invalid"],
    // Better Auth lowercases before the hook runs; this pins the end result.
    ["Login Widget / Mini App, uppercase", "42@TELEGRAM.PLACEHOLDER.INVALID"],
  ])(
    "rejects an email/password sign-up with a %s placeholder",
    async (_namespace, email) => {
      const { client, rows } = await createSqliteAuth({}, authOptions);

      const response = await client.post("/sign-up/email", {
        email,
        password: "correct-horse-battery",
        name: "Squatter",
      });

      expect(response.status).toBe(400);
      expect(response.json.code).toBe("FAILED_TO_CREATE_USER");
      expect(rows("user")).toHaveLength(0);
    }
  );

  it.each([
    "42@telegram.placeholder.invalid",
    "12224742808376279442@telegram-oidc.placeholder.invalid",
  ])(
    "answers 400 instead of a silent success when changing an email to %s",
    async (newEmail) => {
      const { client, db } = createMemoryAuth(
        {},
        {
          ...authOptions,
          user: {
            changeEmail: {
              enabled: true,
              updateEmailWithoutVerification: true,
            },
          },
        }
      );
      await signUp(client);

      const response = await client.post("/change-email", { newEmail });

      expect(response.status).toBe(400);
      expect(response.json.code).toBe("PLACEHOLDER_EMAIL_RESERVED");
      expect(db.user[0]!.email).toBe("ann@example.com");
    }
  );
});

describe("tolerating data written by older versions", () => {
  it("signs in when duplicate Telegram account rows exist", async () => {
    const { client, db } = createMemoryAuth();
    await client.post("/telegram/signin", await signWidgetData({ id: 42 }));
    db.account.push({ ...db.account[0]!, id: "duplicate-row" });
    client.clearCookies();

    const response = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(200);
  });
});
