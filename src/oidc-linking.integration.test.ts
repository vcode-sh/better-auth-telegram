// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createClient,
  createMemoryAuth,
  mockTelegramOIDC,
  signInitData,
  signInWithTelegramOIDC,
  signWidgetData,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";

let provider: TelegramOIDCMock;
beforeEach(async () => {
  provider = await mockTelegramOIDC();
});
afterEach(() => provider.restore());
const config = () => ({
  oidc: { enabled: true, clientSecret: provider.clientSecret },
  miniApp: { enabled: true },
});
const telegramId = 8_306_595_751;

async function miniAppUser(client: ReturnType<typeof createClient>) {
  const response = await client.post("/telegram/miniapp/signin", {
    initData: await signInitData({ id: telegramId }),
  });
  if (response.status !== 200) {
    throw new Error(`Mini App setup failed: ${response.text}`);
  }
  client.clearCookies();
  return response.json.user;
}

describe("OIDC links a proven Telegram identity", () => {
  it("uses the existing Mini App user with a client-submitted ID token", async () => {
    const { client, db } = createMemoryAuth(config());
    const user = await miniAppUser(client);
    const token = await provider.sign(
      telegramClaims({ nonce: "id-token-nonce" })
    );
    const response = await client.post("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token, nonce: "id-token-nonce" },
    });
    expect(response.status).toBe(200);
    expect(response.json.user.id).toBe(user.id);
    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(2);
    expect(db.account[1]).toMatchObject({
      providerId: "telegram-oidc",
      accountId: "12224742808376279442",
      userId: user.id,
    });
  });

  it.each([{ enabled: false }, { disableImplicitLinking: true }])(
    "respects disabled implicit linking: %j",
    async (accountLinking) => {
      const { client, db } = createMemoryAuth(config(), {
        account: { accountLinking },
      });
      await miniAppUser(client);
      const { callback } = await signInWithTelegramOIDC(client, provider);
      expect(callback.status).toBe(401);
      expect(callback.json.code).toBe("ACCOUNT_NOT_LINKED");
      expect(client.hasSession()).toBe(false);
      expect(db.account).toHaveLength(1);
      expect(db.user).toHaveLength(1);
    }
  );

  it.each(["link-account", "sign-in"] as const)(
    "does not persist a link when validateUserInfo rejects %s",
    async (action) => {
      const { client, db } = createMemoryAuth(config(), {
        user: {
          validateUserInfo: ({ source }) => {
            if (source.method === "oauth" && source.action === action) {
              return { error: "APP_REFUSED" };
            }
          },
        },
      });
      await miniAppUser(client);
      const { callback } = await signInWithTelegramOIDC(client, provider);
      expect(callback.status).toBe(403);
      expect(callback.json.code).toBe("APP_REFUSED");
      expect(client.hasSession()).toBe(false);
      expect(db.account).toHaveLength(1);
    }
  );

  it("does not persist a link when an account creation hook refuses it", async () => {
    const { client, db } = createMemoryAuth(config(), {
      databaseHooks: {
        account: {
          create: {
            before: async (account) => {
              await Promise.resolve();
              if (account.providerId === "telegram-oidc") {
                return false;
              }
            },
          },
        },
      },
    });
    await miniAppUser(client);
    const { callback } = await signInWithTelegramOIDC(client, provider);
    expect(callback.status).toBe(403);
    expect(callback.json.code).toBe("ACCOUNT_CREATION_REJECTED");
    expect(client.hasSession()).toBe(false);
    expect(db.account).toHaveLength(1);
  });

  it("rejects an account hook that changes the authentication binding before it writes", async () => {
    const { client, db } = createMemoryAuth(config(), {
      databaseHooks: {
        account: {
          create: {
            before: async (account) => {
              await Promise.resolve();
              if (account.providerId === "telegram-oidc") {
                return { data: { ...account, accountId: "another-sub" } };
              }
            },
          },
        },
      },
    });
    await miniAppUser(client);
    const { callback } = await signInWithTelegramOIDC(client, provider);
    expect(callback.status).toBe(409);
    expect(client.hasSession()).toBe(false);
    expect(db.account).toHaveLength(1);
  });

  it("rechecks linked proof after application account hooks", async () => {
    const { client, db } = createMemoryAuth(config(), {
      databaseHooks: {
        account: {
          create: {
            before: async (account, ctx) => {
              if (account.providerId === "telegram-oidc") {
                const accounts =
                  await ctx!.context.internalAdapter.findAccounts(
                    account.userId
                  );
                for (const proof of accounts) {
                  // biome-ignore lint/performance/noAwaitInLoops: Exercise ordered account revocation inside the creation hook.
                  await ctx!.context.internalAdapter.deleteAccount(proof.id);
                }
              }
            },
          },
        },
      },
    });
    await miniAppUser(client);
    const { callback } = await signInWithTelegramOIDC(client, provider);
    expect(callback.status).toBe(401);
    expect(callback.json.code).toBe("ACCOUNT_NOT_LINKED");
    expect(client.hasSession()).toBe(false);
    expect(
      db.account.filter((account) => account.providerId === "telegram-oidc")
    ).toHaveLength(0);
  });

  it("refuses ambiguous Telegram owners instead of choosing one", async () => {
    const { client, db } = createMemoryAuth(config());
    await miniAppUser(client);
    db.user.push({
      ...db.user[0],
      id: "ambiguous-user",
      email: "ambiguous@example.com",
    });
    const { callback } = await signInWithTelegramOIDC(client, provider);
    expect(callback.status).toBe(409);
    expect(client.hasSession()).toBe(false);
    expect(db.account).toHaveLength(1);
  });

  it("never restores a revoked link from stale user profile data", async () => {
    const { client, db } = createMemoryAuth(config(), {
      account: { accountLinking: { allowUnlinkingAll: true } },
    });
    const previous = await miniAppUser(client);
    // A database hook or old installation can leave stale profile data after deletion.
    db.account.length = 0;
    const { location } = await signInWithTelegramOIDC(client, provider);
    expect(location).toBe("/dashboard");
    expect(db.user).toHaveLength(2);
    expect(db.account[0]!.userId).not.toBe(previous.id);
  });

  it("preserves an existing OIDC binding when older releases already created separate users", async () => {
    const { client, db } = createMemoryAuth(config());
    await signInWithTelegramOIDC(client, provider);
    const oidcUser = db.user[0]!.id;
    client.clearCookies();
    const widget = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );
    const otherUser = widget.json.user.id;
    db.user.find((user) => user.id === otherUser)!.telegramId =
      String(telegramId);
    client.clearCookies();
    const { location } = await signInWithTelegramOIDC(client, provider);
    expect(location).toBe("/dashboard");
    const session = await client.get("/get-session");
    expect(session.json.user.id).toBe(oidcUser);
    expect(db.user).toHaveLength(2);
  });

  it("does not pre-link when the user explicitly links OIDC to another signed-in account", async () => {
    const { auth, client, db } = createMemoryAuth(config(), {
      emailAndPassword: { enabled: true },
      account: {
        accountLinking: {
          trustedProviders: ["telegram-oidc"],
          allowDifferentEmails: true,
        },
      },
    });
    const original = await miniAppUser(client);
    const other = createClient(auth);
    await other.post("/sign-up/email", {
      email: "another@example.com",
      password: "correct-horse-battery",
      name: "Other",
    });
    const link = await other.post("/link-social", {
      provider: "telegram-oidc",
      callbackURL: "/settings",
    });
    const callback = await other.get(
      provider.authorize(link.json.url, telegramClaims())
    );
    expect(callback.headers.get("location")).toBe("/settings");
    const linked = db.account.find(
      (account) => account.providerId === "telegram-oidc"
    )!;
    expect(linked.userId).not.toBe(original.id);
  });
});
