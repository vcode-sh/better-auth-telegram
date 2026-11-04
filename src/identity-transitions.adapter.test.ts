// @vitest-environment node
import { afterEach, describe, expect, it as test } from "vitest";
import { type AdapterAuth, adapterLanes } from "./testing/adapters";
import { signInitData, signWidgetData } from "./testing/harness";

describe.each(adapterLanes())("$name identity authority", (lane) => {
  let fixture: AdapterAuth | undefined;
  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  describe.skipIf(!lane.url)("persisted account proof", () => {
    test("refuses conflicting owners beyond same-owner duplicate rows", async () => {
      fixture = await lane.create({ miniApp: { enabled: true } });
      const { auth, client, rows } = fixture;
      const first = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: 42 })
      );
      const second = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: 43 })
      );
      expect([first.status, second.status]).toEqual([200, 200]);
      const context = await auth.$context;
      for (const userId of [first.json.user.id, second.json.user.id]) {
        // A later conflicting row must not hide behind two copies for one user.
        // biome-ignore lint/performance/noAwaitInLoops: Establish the legacy insertion order.
        await context.internalAdapter.createAccount({
          providerId: "telegram",
          accountId: "42",
          userId,
        });
      }
      client.clearCookies();
      const sessions = await rows("session");

      const widget = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: 42 })
      );
      const miniApp = await client.post("/telegram/miniapp/signin", {
        initData: await signInitData({ id: 42 }),
      });

      expect([widget.status, miniApp.status]).toEqual([409, 409]);
      expect([widget.json.code, miniApp.json.code]).toEqual([
        "TELEGRAM_ALREADY_LINKED_OTHER",
        "TELEGRAM_ALREADY_LINKED_OTHER",
      ]);
      expect(await rows("session")).toEqual(sessions);
      expect(client.hasSession()).toBe(false);
    });

    test.each(["validation", "profile update"])(
      "refuses a new session when %s revokes the proving account",
      async (stage) => {
        let provingAccount = "";
        fixture = await lane.create(
          { miniApp: { enabled: true } },
          {
            user: {
              validateUserInfo: async ({ user, source }, ctx) => {
                if (stage === "validation" && source.action === "sign-in") {
                  const accounts =
                    await ctx.context.internalAdapter.findAccounts(user.id!);
                  const telegram = accounts.find(
                    (account) => account.providerId === "telegram"
                  )!;
                  await ctx.context.internalAdapter.deleteAccount(telegram.id);
                }
              },
            },
            databaseHooks: {
              account: {
                update: {
                  before: async (_data, ctx) => {
                    if (stage === "profile update") {
                      await ctx!.context.internalAdapter.deleteAccount(
                        provingAccount
                      );
                    }
                  },
                },
              },
            },
          }
        );
        const { client, rows } = fixture;
        const first = await client.post(
          "/telegram/signin",
          await signWidgetData({ id: 42, username: "before" })
        );
        expect(first.status).toBe(200);
        provingAccount = (await rows("account"))[0]!.id;
        client.clearCookies();
        const sessions = await rows("session");

        const response = await client.post("/telegram/miniapp/signin", {
          initData: await signInitData({ id: 42, username: "after" }),
        });

        expect(response.status).toBe(401);
        expect(response.json.code).toBe("ACCOUNT_NOT_LINKED");
        expect(await rows("account")).toHaveLength(0);
        expect(await rows("session")).toEqual(sessions);
        expect(client.hasSession()).toBe(false);
      }
    );
  });
});
