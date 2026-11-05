// @vitest-environment node
import { afterEach, beforeEach, expect, it as test } from "vitest";
import {
  createMemoryAuth,
  mockTelegramOIDC,
  signInWithTelegramOIDC,
  type TelegramOIDCMock,
  type TestClient,
  telegramClaims,
} from "./testing/harness";

let provider: TelegramOIDCMock;
beforeEach(async () => {
  provider = await mockTelegramOIDC();
});
afterEach(() => provider.restore());

async function attemptSignIn(client: TestClient, method: string) {
  if (method === "redirect") {
    const { callback, location } = await signInWithTelegramOIDC(
      client,
      provider
    );
    return {
      status: callback.status,
      error: new URL(location!, "https://example.test").searchParams.get(
        "error"
      ),
    };
  }
  const token = await provider.sign({
    sub: "12224742808376279442",
    nonce: "n-1",
  });
  const response = await client.post("/sign-in/social", {
    provider: "telegram-oidc",
    idToken: { token, nonce: "n-1" },
  });
  return { status: response.status, error: response.json.code };
}

test.each([
  { loginWidget: false, method: "redirect", status: 302 },
  { loginWidget: true, method: "redirect", status: 302 },
  { loginWidget: false, method: "idToken", status: 401 },
  { loginWidget: true, method: "idToken", status: 401 },
])(
  "refuses a revoked OIDC account: $method, loginWidget=$loginWidget",
  async ({ loginWidget, method, status }) => {
    const { client, db } = createMemoryAuth(
      {
        loginWidget,
        oidc: { enabled: true, clientSecret: provider.clientSecret },
      },
      {
        account: { updateAccountOnSignIn: false },
        user: {
          validateUserInfo: async ({ user, source }, ctx) => {
            if (source.method === "oauth" && source.action === "sign-in") {
              const accounts = await ctx.context.internalAdapter.findAccounts(
                user.id!
              );
              const account = accounts.find(
                (candidate) => candidate.providerId === "telegram-oidc"
              )!;
              await ctx.context.internalAdapter.deleteAccount(account.id);
            }
          },
        },
      }
    );
    const first = await signInWithTelegramOIDC(client, provider);
    expect(first.location).toBe("/dashboard");
    client.clearCookies();
    const sessionCount = db.session.length;
    const outcome = await attemptSignIn(client, method);

    expect(outcome).toEqual({ status, error: "ACCOUNT_NOT_LINKED" });
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(sessionCount);
    expect(client.hasSession()).toBe(false);
  }
);

test("does not issue a first OIDC session after an account creation hook revokes the account", async () => {
  const { client, db } = createMemoryAuth(
    {
      loginWidget: false,
      oidc: { enabled: true, clientSecret: provider.clientSecret },
    },
    {
      databaseHooks: {
        account: {
          create: {
            after: async (account, ctx) => {
              await ctx!.context.internalAdapter.deleteAccount(account.id);
            },
          },
        },
      },
    }
  );
  await signInWithTelegramOIDC(client, provider);
  expect(db.account).toHaveLength(0);
  expect(db.session).toHaveLength(0);
  expect(client.hasSession()).toBe(false);
});

test("refuses a revoked OIDC account after an optional profile update", async () => {
  const { client, db } = createMemoryAuth(
    {
      loginWidget: false,
      oidc: {
        enabled: true,
        clientSecret: provider.clientSecret,
        updateUserInfoOnSignIn: true,
      },
    },
    {
      databaseHooks: {
        user: {
          update: {
            before: async (_user, ctx) => {
              const account =
                await ctx!.context.internalAdapter.findAccountByKey({
                  providerId: "telegram-oidc",
                  accountId: "12224742808376279442",
                });
              await ctx!.context.internalAdapter.deleteAccount(account!.id);
              return false;
            },
          },
        },
      },
    }
  );
  expect((await signInWithTelegramOIDC(client, provider)).location).toBe(
    "/dashboard"
  );
  client.clearCookies();
  const sessionsBefore = structuredClone(db.session);
  const { location } = await signInWithTelegramOIDC(
    client,
    provider,
    telegramClaims({ name: "Updated name" })
  );
  expect(db.account).toHaveLength(0);
  expect(db.session).toEqual(sessionsBefore);
  expect(client.hasSession()).toBe(false);
  expect(location).toContain("error=ACCOUNT_NOT_LINKED");
});

test.each([
  { loginWidget: false, field: "userId" },
  { loginWidget: true, field: "userId" },
  { loginWidget: false, field: "accountId" },
  { loginWidget: true, field: "accountId" },
  { loginWidget: false, field: "providerId" },
  { loginWidget: true, field: "providerId" },
])(
  "refuses a new OIDC binding changed by an account hook: $field, loginWidget=$loginWidget",
  async ({ loginWidget, field }) => {
    let otherUserId: string;
    const { auth, client, db } = createMemoryAuth(
      {
        loginWidget,
        oidc: { enabled: true, clientSecret: provider.clientSecret },
      },
      {
        databaseHooks: {
          account: {
            create: {
              before: (account) =>
                Promise.resolve(
                  account.providerId === "telegram-oidc"
                    ? {
                        data: {
                          [field]:
                            field === "userId" ? otherUserId : "another-key",
                        },
                      }
                    : undefined
                ),
            },
          },
        },
      }
    );
    const other = await (await auth.$context).internalAdapter.createUser(
      {
        name: "Other user",
        email: "other@example.com",
        emailVerified: false,
      },
      { method: "email-password" }
    );
    otherUserId = other.id;
    const otherBefore = structuredClone(db.user[0]);

    const { location } = await signInWithTelegramOIDC(client, provider);

    expect(location).toContain("error=ACCOUNT_NOT_LINKED");
    expect(client.hasSession()).toBe(false);
    expect(db.session).toHaveLength(0);
    expect(db.user.find((user) => user.id === otherUserId)).toEqual(
      otherBefore
    );
  }
);
