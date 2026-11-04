// @vitest-environment node
/**
 * Adapter lane (`npm run test:adapters`): the core Telegram flows on real
 * databases through Better Auth's adapters. Each database is skipped unless
 * its URL is set (see src/testing/adapters.ts).
 */
import { afterEach, beforeEach, describe, expect, it as test } from "vitest";
import { type AdapterAuth, adapterLanes, attach } from "./testing/adapters";
import {
  createClient,
  mockTelegramOIDC,
  signInitData,
  signInWithTelegramOIDC,
  signWidgetData,
  type TelegramOIDCMock,
  type TestClient,
  telegramClaims,
} from "./testing/harness";

const TELEGRAM_ID = 8_306_595_751;

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

const providers = (accounts: Record<string, any>[]) =>
  accounts.map((account) => account.providerId).sort();

describe.each(adapterLanes())("$name", (lane) => {
  let telegramMock: TelegramOIDCMock;
  let opened: AdapterAuth[] = [];

  beforeEach(async () => {
    telegramMock = await mockTelegramOIDC();
  });

  afterEach(async () => {
    telegramMock?.restore();
    const closing = opened;
    opened = [];
    const results = await Promise.allSettled(
      closing.map((harness) => harness.close())
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Adapter fixture cleanup failed"
      );
    }
  });

  const open = async (authOptions = {}, pluginOptions = {}) => {
    const harness = await lane.create(
      {
        miniApp: { enabled: true },
        oidc: { enabled: true, clientSecret: telegramMock.clientSecret },
        ...pluginOptions,
      },
      {
        emailAndPassword: { enabled: true },
        account: {
          accountLinking: {
            allowDifferentEmails: true,
            trustedProviders: ["telegram-oidc"],
          },
        },
        ...authOptions,
      }
    );
    opened.push(harness);
    return harness;
  };

  describe.skipIf(!lane.url)("core flows", () => {
    test("signs a Login Widget user up, then back into the same user", async () => {
      const { client, rows } = await open();

      const first = await client.post(
        "/telegram/signin",
        await signWidgetData({
          id: TELEGRAM_ID,
          first_name: "Zoë 🦄",
          last_name: "Ünïcødé مرحبا",
          username: "ann",
        })
      );
      client.clearCookies();
      const again = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: TELEGRAM_ID, first_name: "Zoë 🦄" })
      );

      expect([first.status, again.status]).toEqual([200, 200]);
      const users = await rows("user");
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({
        name: "Zoë 🦄 Ünïcødé مرحبا",
        email: "8306595751@telegram.placeholder.invalid",
        emailVerified: false,
        telegramId: "8306595751",
      });
      // The username was removed in Telegram between the two sign-ins.
      expect(users[0]!.telegramUsername ?? null).toBeNull();
      const accounts = await rows("account");
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        providerId: "telegram",
        accountId: "8306595751",
        userId: users[0]!.id,
      });
    });

    test("selects the matching Widget user for Mini App sign-in among different users", async () => {
      const { client, rows } = await open();
      const unrelated = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: 17, first_name: "Other" })
      );
      client.clearCookies();
      const widget = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: TELEGRAM_ID })
      );
      expect([unrelated.status, widget.status]).toEqual([200, 200]);
      expect(widget.json.user.id).not.toBe(unrelated.json.user.id);
      client.clearCookies();

      const response = await client.post("/telegram/miniapp/signin", {
        initData: await signInitData({ id: TELEGRAM_ID }),
      });
      const session = await client.get("/get-session");

      expect(response.status).toBe(200);
      expect(response.json.user.id).toBe(widget.json.user.id);
      expect(response.json.session.userId).toBe(widget.json.user.id);
      expect(session.json.user.id).toBe(widget.json.user.id);
      expect(await rows("user")).toHaveLength(2);
      expect(await rows("account")).toHaveLength(2);
    });

    test("copies the Telegram identity from OIDC, so the Mini App finds that user", async () => {
      const { client, rows } = await open();

      const { location } = await signInWithTelegramOIDC(
        client,
        telegramMock,
        telegramClaims({ phone_number: "48572068680" })
      );
      client.clearCookies();
      const miniApp = await client.post("/telegram/miniapp/signin", {
        initData: await signInitData({ id: TELEGRAM_ID, username: "ann" }),
      });

      expect(location).toBe("/dashboard");
      expect(miniApp.status).toBe(200);
      const users = await rows("user");
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({
        telegramId: "8306595751",
        telegramUsername: "ann",
        telegramPhoneNumber: "48572068680",
      });
      expect(providers(await rows("account"))).toEqual([
        "telegram",
        "telegram-oidc",
      ]);
    });

    test("stores an opaque OIDC subject without using it as an email local part", async () => {
      const { client, rows } = await open();
      const sub = "urn:telegram:user:42";
      const { location } = await signInWithTelegramOIDC(
        client,
        telegramMock,
        telegramClaims({ sub })
      );
      const session = await client.get("/get-session");

      expect(location).toBe("/dashboard");
      const [user] = await rows("user");
      expect(session.json.user.id).toBe(user!.id);
      const [local, domain] = user!.email.split("@");
      expect(local.length).toBeLessThanOrEqual(64);
      expect(domain).toBe("telegram-oidc.placeholder.invalid");
      expect(await rows("account")).toEqual([
        expect.objectContaining({
          providerId: "telegram-oidc",
          accountId: sub,
          userId: user!.id,
        }),
      ]);
    });

    test.each(["Login Widget", "Mini App"])(
      "signs the existing %s user in through OIDC without changing their email",
      async (method) => {
        const mappedEmail = () => ({ email: "ann@example.com" });
        const { client, rows } = await open(
          { account: { accountLinking: {} } },
          {
            mapTelegramDataToUser: mappedEmail,
            miniApp: {
              enabled: true,
              mapMiniAppDataToUser: mappedEmail,
            },
          }
        );
        const first =
          method === "Login Widget"
            ? await client.post(
                "/telegram/signin",
                await signWidgetData({ id: TELEGRAM_ID })
              )
            : await client.post("/telegram/miniapp/signin", {
                initData: await signInitData({ id: TELEGRAM_ID }),
              });
        expect(first.status).toBe(200);
        const userId = first.json.user.id;
        client.clearCookies();

        const { location } = await signInWithTelegramOIDC(client, telegramMock);
        const session = await client.get("/get-session");

        expect(location).toBe("/dashboard");
        expect(session.json.user.id).toBe(userId);
        const users = await rows("user");
        expect(users).toHaveLength(1);
        expect(users[0]).toMatchObject({
          id: userId,
          email: "ann@example.com",
          telegramId: String(TELEGRAM_ID),
        });
        const accounts = await rows("account");
        expect(accounts).toHaveLength(2);
        expect(accounts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              providerId: "telegram",
              accountId: String(TELEGRAM_ID),
              userId,
            }),
            expect.objectContaining({
              providerId: "telegram-oidc",
              accountId: "12224742808376279442",
              userId,
            }),
          ])
        );
      }
    );

    test("links concurrent first OIDC sign-ins to one existing Mini App user", async () => {
      const { auth, client, rows } = await open({
        account: { accountLinking: {} },
      });
      const first = await client.post("/telegram/miniapp/signin", {
        initData: await signInitData({ id: TELEGRAM_ID }),
      });
      expect(first.status).toBe(200);
      const userId = first.json.user.id;
      const clients = Array.from({ length: 4 }, () => createClient(auth));

      const results = await Promise.all(
        clients.map((visitor) => signInWithTelegramOIDC(visitor, telegramMock))
      );
      const sessions = await Promise.all(
        clients.map((visitor) => visitor.get("/get-session"))
      );

      expect(results.map(({ location }) => location)).toEqual(
        new Array(4).fill("/dashboard")
      );
      expect(sessions.map(({ json }) => json.user.id)).toEqual(
        new Array(4).fill(userId)
      );
      expect(await rows("user")).toHaveLength(1);
      const accounts = await rows("account");
      expect(accounts).toHaveLength(2);
      expect(providers(accounts)).toEqual(["telegram", "telegram-oidc"]);
      expect(accounts.every((account) => account.userId === userId)).toBe(true);
    });

    test.each([{ enabled: false }, { disableImplicitLinking: true }])(
      "refuses cross-flow OIDC linking when configured with %j",
      async (accountLinking) => {
        const { client, rows } = await open({ account: { accountLinking } });
        const first = await client.post("/telegram/miniapp/signin", {
          initData: await signInitData({ id: TELEGRAM_ID }),
        });
        expect(first.status).toBe(200);
        const usersBefore = await rows("user");
        const accountsBefore = await rows("account");
        const sessionsBefore = await rows("session");
        client.clearCookies();

        const { callback } = await signInWithTelegramOIDC(client, telegramMock);

        expect(callback.status).toBe(401);
        expect(callback.json.code).toBe("ACCOUNT_NOT_LINKED");
        expect(client.hasSession()).toBe(false);
        expect(await rows("user")).toEqual(usersBefore);
        expect(await rows("account")).toEqual(accountsBefore);
        expect(await rows("session")).toEqual(sessionsBefore);
      }
    );

    // Drizzle/Prisma defaults do not roll back a write after a later guard throws.
    // Check durable rows, with a valid second owner so foreign keys cannot hide a bad link.
    test.each(["accountId", "providerId", "userId"] as const)(
      "rejects account hooks changing OIDC %s without persisting a binding",
      async (field) => {
        let otherUserId = "";
        const { auth, client, rows } = await open({
          databaseHooks: {
            account: {
              create: {
                before: (account: {
                  providerId: string;
                  [key: string]: unknown;
                }) => {
                  if (account.providerId === "telegram-oidc") {
                    const replacement =
                      field === "userId" ? otherUserId : "different-binding";
                    return { data: { ...account, [field]: replacement } };
                  }
                },
              },
            },
          },
        });
        const original = await client.post("/telegram/miniapp/signin", {
          initData: await signInitData({ id: TELEGRAM_ID }),
        });
        expect(original.status).toBe(200);
        const other = createClient(auth);
        await signUp(other);
        const otherSession = await other.get("/get-session");
        expect(otherSession.status).toBe(200);
        otherUserId = otherSession.json.user.id;
        expect(otherUserId).not.toBe(original.json.user.id);
        const before = {
          users: await rows("user"),
          accounts: await rows("account"),
          sessions: await rows("session"),
        };
        client.clearCookies();

        const { callback } = await signInWithTelegramOIDC(client, telegramMock);

        expect(callback.status).toBe(409);
        expect(callback.json.code).toBe("TELEGRAM_ALREADY_LINKED_OTHER");
        expect(client.hasSession()).toBe(false);
        expect({
          users: await rows("user"),
          accounts: await rows("account"),
          sessions: await rows("session"),
        }).toEqual(before);
      }
    );

    test("links and unlinks Telegram, and unlinking revokes the telegramId sign-in", async () => {
      const { auth, client, rows } = await open();
      await signUp(client);

      const link = await client.post(
        "/telegram/link",
        await signWidgetData({ id: TELEGRAM_ID })
      );
      const linked = (await rows("user"))[0]!;
      const unlink = await client.post("/telegram/unlink", {});
      // Unlinked: the Telegram user signs up anew instead of into Ann.
      const stranger = createClient(auth);
      const newSignIn = await stranger.post(
        "/telegram/signin",
        await signWidgetData({ id: TELEGRAM_ID })
      );
      const newSession = await stranger.get("/get-session");

      expect([link.status, unlink.status, newSignIn.status]).toEqual([
        200, 200, 200,
      ]);
      expect(linked.telegramId).toBe("8306595751");
      const users = await rows("user");
      const ann = users.find((user) => user.email === "ann@example.com")!;
      expect(ann.telegramId ?? null).toBeNull();
      expect(users).toHaveLength(2);
      expect(newSignIn.json.user.id).not.toBe(ann.id);
      expect(newSession.json.user.id).toBe(newSignIn.json.user.id);
      const accounts = await rows("account");
      expect(
        accounts
          .filter((account) => account.userId === ann.id)
          .map((account) => account.providerId)
      ).toEqual(["credential"]);
      expect(
        accounts.find((account) => account.providerId === "telegram")?.userId
      ).toBe(newSignIn.json.user.id);
    });

    test("clears telegramId when the OIDC account is unlinked through Better Auth", async () => {
      const { client, rows } = await open();
      await signUp(client);
      const start = await client.post("/link-social", {
        provider: "telegram-oidc",
        callbackURL: "/settings",
      });
      await client.get(
        telegramMock.authorize(start.json.url, telegramClaims())
      );
      const linked = (await rows("user"))[0]!.telegramId;

      const oidcAccount = (await rows("account")).find(
        (account) => account.providerId === "telegram-oidc"
      )!;
      const unlink = await client.post("/unlink-account", {
        accountId: oidcAccount.id,
      });

      expect(linked).toBe("8306595751");
      expect(unlink.status).toBe(200);
      expect((await rows("user"))[0]!.telegramId ?? null).toBeNull();
    });

    // A double-submitted widget callback or React strict mode running the
    // Mini App auto sign-in twice: both requests sign in, one user exists.
    test("signs concurrent first sign-ins of one Telegram user into a single user", async () => {
      const { auth, rows } = await open();
      const widget = await signWidgetData({ id: TELEGRAM_ID });
      const initData = await signInitData({ id: TELEGRAM_ID });

      const responses = await Promise.all([
        createClient(auth).post("/telegram/signin", widget),
        createClient(auth).post("/telegram/signin", widget),
        createClient(auth).post("/telegram/miniapp/signin", { initData }),
        createClient(auth).post("/telegram/miniapp/signin", { initData }),
      ]);

      expect(responses.map((response) => response.status)).toEqual([
        200, 200, 200, 200,
      ]);
      expect(await rows("user")).toHaveLength(1);
      expect(await rows("account")).toHaveLength(1);
      const userIds = new Set(
        responses.map((response) => response.json.user.id)
      );
      expect(userIds.size).toBe(1);
    });
  });

  // Two servers on one database: no shared memory, only the database's
  // unique `user.email` decides. MongoDB has no unique indexes (Better Auth
  // creates none), so it can't decide.
  describe.skipIf(!(lane.url && lane.concurrentServers))("two servers", () => {
    test("signs concurrent first sign-ins on two servers into a single user", async () => {
      const first = await open();
      const second = await attach(first);
      const widget = await signWidgetData({ id: TELEGRAM_ID });

      const responses = await Promise.all([
        createClient(first.auth).post("/telegram/signin", widget),
        createClient(second.auth).post("/telegram/signin", widget),
        createClient(first.auth).post("/telegram/signin", widget),
        createClient(second.auth).post("/telegram/signin", widget),
      ]);

      expect(responses.map((response) => response.status)).toEqual([
        200, 200, 200, 200,
      ]);
      const users = await first.rows("user");
      expect(users).toHaveLength(1);
      expect(await first.rows("account")).toHaveLength(1);
      expect(responses.map((response) => response.json.session.userId)).toEqual(
        new Array(4).fill(users[0]!.id)
      );
    });
  });

  // Better Auth's PostgreSQL migrations type these ids as integer / uuid
  // columns, and PostgreSQL is strict about the parameters it compares.
  describe.skipIf(!(lane.url && lane.generatedIds))(
    "database-generated ids",
    () => {
      test.each(["serial", "uuid"] as const)(
        'works with generateId: "%s"',
        async (generateId) => {
          const { auth, client, rows } = await open({
            advanced: { database: { generateId } },
          });
          await signInWithTelegramOIDC(client, telegramMock);
          const other = createClient(auth);
          await signUp(other);

          const self = await client.post(
            "/telegram/link",
            await signWidgetData({ id: TELEGRAM_ID })
          );
          const foreign = await other.post(
            "/telegram/link",
            await signWidgetData({ id: TELEGRAM_ID })
          );
          const again = await client.post(
            "/telegram/link",
            await signWidgetData({ id: TELEGRAM_ID })
          );

          expect([self.status, foreign.status, again.status]).toEqual([
            200, 409, 409,
          ]);
          expect(foreign.json.code).toBe("TELEGRAM_ALREADY_LINKED_OTHER");
          expect(again.json.code).toBe("TELEGRAM_ALREADY_LINKED_SELF");
          expect(providers(await rows("account"))).toEqual([
            "credential",
            "telegram",
            "telegram-oidc",
          ]);
        }
      );
    }
  );
});
