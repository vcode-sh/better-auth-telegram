// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createMemoryAuth,
  signInitData,
  signWidgetData,
} from "./testing/harness";

describe("Telegram identity authority transitions", () => {
  it("keeps the stored profile and an authenticated session when a username update is vetoed", async () => {
    const { client, db } = createMemoryAuth(
      {},
      {
        session: { cookieCache: { enabled: true } },
        databaseHooks: { user: { update: { before: async () => false } } },
      }
    );
    const first = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42, username: "before" })
    );
    expect(first.status).toBe(200);
    const storedUser = structuredClone(db.user[0]);
    client.clearCookies();

    const response = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42, username: "after" })
    );
    const session = await client.get("/get-session");

    // Preserve the existing contract: a metadata veto keeps the stored profile;
    // the independently proven account can still authorize this sign-in.
    expect(response.status).toBe(200);
    expect(response.json.user).toMatchObject({
      id: first.json.user.id,
      telegramId: "42",
      telegramUsername: "before",
    });
    expect(db.user).toEqual([storedUser]);
    expect(db.account[0]).toMatchObject({
      userId: first.json.user.id,
      telegramUsername: "after",
    });
    expect(session.status).toBe(200);
    expect(session.json.user).toMatchObject({
      id: first.json.user.id,
      telegramId: "42",
      telegramUsername: "before",
    });
    expect(db.session).toHaveLength(2);
  });

  it.each(["Widget", "Mini App"])(
    "%s refuses a Telegram account key held by different users",
    async (method) => {
      const { auth, client, db } = createMemoryAuth({
        miniApp: { enabled: true },
      });
      const first = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: 42 })
      );
      client.clearCookies();
      const second = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: 43 })
      );
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.json.user.id).not.toBe(first.json.user.id);
      const context = await auth.$context;
      // Same-owner duplicates remain supported, but must not hide a later conflict.
      await context.internalAdapter.createAccount({
        providerId: "telegram",
        accountId: "42",
        userId: first.json.user.id,
      });
      await context.internalAdapter.createAccount({
        providerId: "telegram",
        accountId: "42",
        userId: second.json.user.id,
      });
      client.clearCookies();
      const before = structuredClone({
        users: db.user,
        accounts: db.account,
        sessions: db.session,
      });

      const response =
        method === "Widget"
          ? await client.post(
              "/telegram/signin",
              await signWidgetData({ id: 42 })
            )
          : await client.post("/telegram/miniapp/signin", {
              initData: await signInitData({ id: 42 }),
            });

      expect(response.status).toBe(409);
      expect(response.json.code).toBe("TELEGRAM_ALREADY_LINKED_OTHER");
      expect(client.hasSession()).toBe(false);
      expect({
        users: db.user,
        accounts: db.account,
        sessions: db.session,
      }).toEqual(before);
    }
  );

  it("does not issue a returning-user session after its account is revoked during validation", async () => {
    const { client, db } = createMemoryAuth(
      {},
      {
        user: {
          validateUserInfo: async ({ user, source }, ctx) => {
            if (
              source.method === "telegram-login-widget" &&
              source.action === "sign-in"
            ) {
              const accounts = await ctx.context.internalAdapter.findAccounts(
                user.id!
              );
              const account = accounts.find(
                (candidate) => candidate.providerId === "telegram"
              );
              await ctx.context.internalAdapter.deleteAccount(account!.id);
            }
          },
        },
      }
    );
    const first = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );
    expect(first.status).toBe(200);
    client.clearCookies();
    const sessionCount = db.session.length;

    const response = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(401);
    expect(response.json.code).toBe("ACCOUNT_NOT_LINKED");
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(sessionCount);
    expect(client.hasSession()).toBe(false);
  });

  it("does not reuse a validation decision after the account moves to another user", async () => {
    let replacementOwner = "";
    const { client, db } = createMemoryAuth(
      {},
      {
        user: {
          validateUserInfo: async ({ user, source }, ctx) => {
            if (
              source.method === "telegram-login-widget" &&
              source.action === "sign-in"
            ) {
              const accounts = await ctx.context.internalAdapter.findAccounts(
                user.id!
              );
              const account = accounts.find(
                (candidate) => candidate.providerId === "telegram"
              )!;
              await ctx.context.internalAdapter.updateAccount(account.id, {
                userId: replacementOwner,
              });
            }
          },
        },
      }
    );
    const first = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );
    const other = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 43 })
    );
    expect([first.status, other.status]).toEqual([200, 200]);
    replacementOwner = other.json.user.id;
    expect(replacementOwner).not.toBe(first.json.user.id);
    client.clearCookies();
    const sessionCount = db.session.length;

    const response = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(401);
    expect(response.json.code).toBe("ACCOUNT_NOT_LINKED");
    expect(
      db.account.find((account) => account.accountId === "42")!.userId
    ).toBe(replacementOwner);
    expect(db.session).toHaveLength(sessionCount);
    expect(client.hasSession()).toBe(false);
  });

  it.each([
    { profile: "outdated", profileAlreadyCurrent: false },
    { profile: "already current", profileAlreadyCurrent: true },
  ])(
    "does not issue a session after an account hook revokes its proof while the user profile is $profile",
    async ({ profileAlreadyCurrent }) => {
      let accountId = "";
      const { auth, client, db } = createMemoryAuth(
        {},
        {
          databaseHooks: {
            account: {
              update: {
                before: async (_account, ctx) => {
                  await ctx!.context.internalAdapter.deleteAccount(accountId);
                },
              },
            },
          },
        }
      );
      const first = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: 42, username: "before" })
      );
      expect(first.status).toBe(200);
      accountId = db.account[0]!.id;
      if (profileAlreadyCurrent) {
        // Other sign-in methods can refresh the user before this account catches up.
        const context = await auth.$context;
        await context.internalAdapter.updateUser(first.json.user.id, {
          telegramUsername: "after",
        });
      }
      client.clearCookies();
      const sessions = structuredClone(db.session);

      const response = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: 42, username: "after" })
      );

      expect(response.status).toBe(401);
      expect(response.json.code).toBe("ACCOUNT_NOT_LINKED");
      expect(db.account).toHaveLength(0);
      expect(db.session).toEqual(sessions);
      expect(client.hasSession()).toBe(false);
    }
  );
});
