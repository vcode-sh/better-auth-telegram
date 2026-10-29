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
    telegramMock.restore();
    await Promise.all(opened.map((harness) => harness.close()));
    opened = [];
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

    test("signs a Mini App user into the Login Widget user", async () => {
      const { client, rows } = await open();
      await client.post(
        "/telegram/signin",
        await signWidgetData({ id: TELEGRAM_ID })
      );
      client.clearCookies();

      const response = await client.post("/telegram/miniapp/signin", {
        initData: await signInitData({ id: TELEGRAM_ID }),
      });

      expect(response.status).toBe(200);
      expect(await rows("user")).toHaveLength(1);
      expect(await rows("account")).toHaveLength(1);
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
      await stranger.post(
        "/telegram/signin",
        await signWidgetData({ id: TELEGRAM_ID })
      );

      expect([link.status, unlink.status]).toEqual([200, 200]);
      expect(linked.telegramId).toBe("8306595751");
      const users = await rows("user");
      const ann = users.find((user) => user.email === "ann@example.com")!;
      expect(ann.telegramId ?? null).toBeNull();
      expect(users).toHaveLength(2);
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
      expect(await first.rows("user")).toHaveLength(1);
      expect(await first.rows("account")).toHaveLength(1);
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

          expect(self.status).toBe(200);
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
