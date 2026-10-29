// @vitest-environment node
/**
 * Login Widget and Mini App flows against a real Better Auth instance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClient,
  createMemoryAuth,
  createSqliteAuth,
  signInitData,
  signInitParams,
  signWidgetData,
} from "./testing/harness";

const widgetUser = (id = 42, extra: Record<string, string | number> = {}) =>
  signWidgetData({ id, first_name: "Ann", username: "ann", ...extra });

describe("Login Widget sign-in", () => {
  it("works on a SQL database with the schema Better Auth generates", async () => {
    const { client, rows } = await createSqliteAuth();

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(200);
    expect(client.hasSession()).toBe(true);
    expect(rows("user")[0]).toMatchObject({
      name: "Ann",
      email: "42@telegram.placeholder.invalid",
      emailVerified: 0,
      telegramId: "42",
      telegramUsername: "ann",
    });
    expect(rows("account")[0]).toMatchObject({
      providerId: "telegram",
      accountId: "42",
    });
  });

  it("keeps an email returned by mapTelegramDataToUser", async () => {
    const { client, db } = createMemoryAuth({
      mapTelegramDataToUser: (data) => ({
        name: data.first_name,
        email: `ann-${data.id}@example.com`,
      }),
    });

    await client.post("/telegram/signin", await widgetUser());

    expect(db.user[0]!.email).toBe("ann-42@example.com");
  });

  it("returns the same user on the next sign-in and refreshes the username", async () => {
    const { client, db } = createMemoryAuth();
    await client.post("/telegram/signin", await widgetUser());
    client.clearCookies();

    const response = await client.post(
      "/telegram/signin",
      await widgetUser(42, { username: "ann_new" })
    );

    expect(response.status).toBe(200);
    expect(db.user).toHaveLength(1);
    expect(db.user[0]!.telegramUsername).toBe("ann_new");
    expect(db.account[0]!.telegramUsername).toBe("ann_new");
  });

  it("runs Better Auth database hooks for the new user and account", async () => {
    const userBefore = vi.fn();
    const accountAfter = vi.fn();
    const { client } = createMemoryAuth(
      {},
      {
        databaseHooks: {
          user: { create: { before: userBefore } },
          account: { create: { after: accountAfter } },
        },
      }
    );

    await client.post("/telegram/signin", await widgetUser());

    expect(userBefore).toHaveBeenCalledOnce();
    expect(accountAfter).toHaveBeenCalledOnce();
  });

  it("honors user.validateUserInfo", async () => {
    const validateUserInfo = vi.fn(async () => ({ error: "not_invited" }));
    const { client, db } = createMemoryAuth({}, { user: { validateUserInfo } });

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("not_invited");
    expect(validateUserInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          action: "create-user",
          method: "telegram-login-widget",
        }),
      }),
      expect.anything()
    );
    expect(db.user).toHaveLength(0);
  });

  it("rejects a payload signed with a different bot token", async () => {
    const { client, db } = createMemoryAuth();

    const response = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 }, "999:other-bot-token")
    );

    expect(response.status).toBe(401);
    expect(db.user).toHaveLength(0);
  });

  it("answers 404 when auto-create is disabled", async () => {
    const { client, db } = createMemoryAuth({ autoCreateUser: false });

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(404);
    expect(db.user).toHaveLength(0);
  });
});

describe("Linking and unlinking Telegram", () => {
  async function signedUpClient(pluginOptions = {}) {
    const harness = createMemoryAuth(pluginOptions, {
      emailAndPassword: { enabled: true },
    });
    const signUp = await harness.client.post("/sign-up/email", {
      email: "ann@example.com",
      password: "correct-horse-battery",
      name: "Ann",
    });
    if (signUp.status !== 200) {
      throw new Error(`sign-up failed: ${signUp.status} ${signUp.text}`);
    }
    return harness;
  }

  it("links Telegram to the signed-in user", async () => {
    const { client, db } = await signedUpClient();

    const response = await client.post("/telegram/link", await widgetUser());

    expect(response.status).toBe(200);
    expect(db.account.map((account) => account.providerId).sort()).toEqual([
      "credential",
      "telegram",
    ]);
    expect(db.user[0]!.telegramId).toBe("42");
  });

  it("refuses to link a Telegram id another user already has", async () => {
    const { auth, client, db } = await signedUpClient();
    const other = createClient(auth);
    await other.post("/telegram/signin", await widgetUser(42));

    const response = await client.post("/telegram/link", await widgetUser(42));

    expect(response.status).toBe(409);
    expect(response.json.code).toBe("TELEGRAM_ALREADY_LINKED_OTHER");
    expect(
      db.account.filter((account) => account.providerId === "telegram")
    ).toHaveLength(1);
  });

  it("unlinks Telegram when the user has another way to sign in", async () => {
    const { client, db } = await signedUpClient();
    await client.post("/telegram/link", await widgetUser());

    const response = await client.post("/telegram/unlink", {});

    expect(response.status).toBe(200);
    expect(db.account.map((account) => account.providerId)).toEqual([
      "credential",
    ]);
    expect(db.user[0]!.telegramId).toBeNull();
  });

  it("refuses to unlink the user's only account", async () => {
    const { client, db } = createMemoryAuth();
    await client.post("/telegram/signin", await widgetUser());

    const response = await client.post("/telegram/unlink", {});

    expect(response.status).toBe(400);
    expect(response.json.code).toBe("CANNOT_UNLINK_LAST_ACCOUNT");
    expect(db.account).toHaveLength(1);
  });

  it("unlinks the only account when Better Auth allows unlinking all", async () => {
    const { client, db } = createMemoryAuth(
      {},
      { account: { accountLinking: { allowUnlinkingAll: true } } }
    );
    await client.post("/telegram/signin", await widgetUser());

    const response = await client.post("/telegram/unlink", {});

    expect(response.status).toBe(200);
    expect(db.account).toHaveLength(0);
  });
});

describe("Mini App sign-in", () => {
  const miniApp = { miniApp: { enabled: true } };

  it("works on a SQL database with the schema Better Auth generates", async () => {
    const { client, rows } = await createSqliteAuth(miniApp);

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7, username: "ann" }),
    });

    expect(response.status).toBe(200);
    expect(rows("user")[0]).toMatchObject({
      email: "7@telegram.placeholder.invalid",
      telegramId: "7",
      telegramUsername: "ann",
    });
  });

  it("signs a Login Widget user into the same account", async () => {
    const { client, db } = createMemoryAuth(miniApp);
    await client.post("/telegram/signin", await widgetUser(7));
    client.clearCookies();

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7 }),
    });

    expect(response.status).toBe(200);
    expect(db.user).toHaveLength(1);
  });

  it("honors user.validateUserInfo and reports the Mini App as the method", async () => {
    const validateUserInfo = vi.fn(async () => ({ error: "not_invited" }));
    const { client, db } = createMemoryAuth(miniApp, {
      user: { validateUserInfo },
    });

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7 }),
    });

    expect(response.status).toBe(403);
    expect(validateUserInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          action: "create-user",
          method: "telegram-mini-app",
        }),
      }),
      expect.anything()
    );
    expect(db.user).toHaveLength(0);
  });

  it("rejects tampered initData", async () => {
    const { client } = createMemoryAuth(miniApp);
    const initData = (await signInitData({ id: 7 })).replace("Ann", "Bob");

    const response = await client.post("/telegram/miniapp/signin", {
      initData,
    });

    expect(response.status).toBe(401);
  });

  it("validates initData without creating a user or a session", async () => {
    const { client, db } = createMemoryAuth(miniApp);

    const response = await client.post("/telegram/miniapp/validate", {
      initData: await signInitData({ id: 7 }),
    });

    expect(response.status).toBe(200);
    expect(response.json.valid).toBe(true);
    expect(db.user).toHaveLength(0);
    expect(db.session).toHaveLength(0);
    expect(client.hasSession()).toBe(false);
  });

  it("returns the parsed user and chat objects from the validate endpoint", async () => {
    const { client } = createMemoryAuth(miniApp);
    const chat = { id: -100_123, type: "supergroup", title: "Ann's group" };

    const response = await client.post("/telegram/miniapp/validate", {
      initData: await signInitData(
        { id: 7, username: "ann" },
        { chat: JSON.stringify(chat), start_param: "ref123" }
      ),
    });

    expect(response.json.data.user).toMatchObject({ id: 7, username: "ann" });
    expect(response.json.data.chat).toEqual(chat);
    expect(response.json.data.start_param).toBe("ref123");
  });
});

describe("Login Widget request validation", () => {
  it("answers 400 for a payload without the signed fields", async () => {
    const { client } = createMemoryAuth();

    const response = await client.post("/telegram/signin", { id: 42 });

    expect(response.status).toBe(400);
  });

  it("answers 500 when the bot token is not configured", async () => {
    const { client } = createMemoryAuth({ botToken: "" });

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(500);
    expect(response.json.code).toBe("BOT_TOKEN_REQUIRED");
  });

  it("requires a session to link", async () => {
    const { client } = createMemoryAuth();

    const response = await client.post("/telegram/link", await widgetUser());

    expect(response.status).toBe(401);
  });

  it("answers 403 when linking is disabled", async () => {
    const { client } = createMemoryAuth({ allowUserToLink: false });
    await client.post("/telegram/signin", await widgetUser());

    const response = await client.post("/telegram/link", await widgetUser(43));

    expect(response.status).toBe(403);
  });

  it("answers 409 when the Telegram account is already linked to this user", async () => {
    const { client } = createMemoryAuth();
    await client.post("/telegram/signin", await widgetUser());

    const response = await client.post("/telegram/link", await widgetUser());

    expect(response.status).toBe(409);
    expect(response.json.code).toBe("TELEGRAM_ALREADY_LINKED_SELF");
  });

  it("answers 404 when unlinking a user without Telegram", async () => {
    const { client } = createMemoryAuth(
      {},
      { emailAndPassword: { enabled: true } }
    );
    await client.post("/sign-up/email", {
      email: "ann@example.com",
      password: "correct-horse-battery",
      name: "Ann",
    });

    const response = await client.post("/telegram/unlink", {});

    expect(response.status).toBe(404);
  });
});

describe("Mini App request validation", () => {
  const miniApp = (options = {}) => ({
    miniApp: { enabled: true, ...options },
  });

  it("answers 400 without initData", async () => {
    const { client } = createMemoryAuth(miniApp());

    const signIn = await client.post("/telegram/miniapp/signin", {});
    const validate = await client.post("/telegram/miniapp/validate", {});

    expect(signIn.status).toBe(400);
    expect(validate.status).toBe(400);
  });

  it("answers 500 when the bot token is not configured", async () => {
    const { client } = createMemoryAuth({ botToken: "", ...miniApp() });
    const initData = await signInitData({ id: 7 });

    const signIn = await client.post("/telegram/miniapp/signin", { initData });
    const validate = await client.post("/telegram/miniapp/validate", {
      initData,
    });

    expect(signIn.status).toBe(500);
    expect(validate.status).toBe(500);
  });

  it("answers 400 when initData has no user", async () => {
    const { client } = createMemoryAuth(miniApp());
    const initData = await signInitParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    });

    const response = await client.post("/telegram/miniapp/signin", {
      initData,
    });

    expect(response.status).toBe(400);
    expect(response.json.code).toBe("NO_USER_IN_INIT_DATA");
  });

  it("answers 400 for unsigned data with a broken structure when validation is off", async () => {
    const { client } = createMemoryAuth(miniApp({ validateInitData: false }));

    const response = await client.post("/telegram/miniapp/signin", {
      initData: "user=%7B%7D&hash=x",
    });

    expect(response.status).toBe(400);
    expect(response.json.code).toBe("INVALID_MINI_APP_DATA_STRUCTURE");
  });

  it("answers 404 when auto sign-up from Mini Apps is disabled", async () => {
    const { client, db } = createMemoryAuth(
      miniApp({ allowAutoSignin: false })
    );

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7 }),
    });

    expect(response.status).toBe(404);
    expect(db.user).toHaveLength(0);
  });

  it("uses mapMiniAppDataToUser", async () => {
    const { client, db } = createMemoryAuth(
      miniApp({
        mapMiniAppDataToUser: (user: { id: number }) => ({
          name: `Mini ${user.id}`,
        }),
      })
    );

    await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7 }),
    });

    expect(db.user[0]!.name).toBe("Mini 7");
  });

  it("reports invalid initData from the validate endpoint", async () => {
    const { client } = createMemoryAuth(miniApp());
    const initData = (await signInitData({ id: 7 })).replace("Ann", "Bob");

    const response = await client.post("/telegram/miniapp/validate", {
      initData,
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ valid: false, data: null });
  });
});

describe("Telegram account bookkeeping", () => {
  it("does not write when nothing changed since the last sign-in", async () => {
    const userUpdate = vi.fn();
    const { client } = createMemoryAuth(
      {},
      { databaseHooks: { user: { update: { before: userUpdate } } } }
    );
    await client.post("/telegram/signin", await widgetUser());
    client.clearCookies();

    await client.post("/telegram/signin", await widgetUser());

    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("does not write on every sign-in for users without a Telegram username", async () => {
    const userUpdate = vi.fn();
    const accountUpdate = vi.fn();
    // SQL returns null for the missing username; the memory adapter keeps
    // undefined, which would hide the bug.
    const { client } = await createSqliteAuth(
      {},
      {
        databaseHooks: {
          user: { update: { before: userUpdate } },
          account: { update: { before: accountUpdate } },
        },
      }
    );
    const noUsername = () => signWidgetData({ id: 42, first_name: "Ann" });
    await client.post("/telegram/signin", await noUsername());
    client.clearCookies();

    await client.post("/telegram/signin", await noUsername());

    expect(userUpdate).not.toHaveBeenCalled();
    expect(accountUpdate).not.toHaveBeenCalled();
  });

  it("restores a missing telegramId on users that already have the account", async () => {
    const { client, db } = createMemoryAuth();
    await client.post("/telegram/signin", await widgetUser());
    db.user[0]!.telegramId = null;
    client.clearCookies();

    await client.post("/telegram/signin", await widgetUser());

    expect(db.user[0]!.telegramId).toBe("42");
  });

  it("answers 500 for an account whose user was deleted", async () => {
    const { client, db } = createMemoryAuth();
    await client.post("/telegram/signin", await widgetUser());
    db.user.length = 0;
    client.clearCookies();

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(500);
    expect(response.json.code).toBe("ORPHANED_ACCOUNT");
  });

  it("refuses to link a Telegram id that only another user's profile has", async () => {
    const { auth, client, db } = createMemoryAuth(
      {},
      { emailAndPassword: { enabled: true } }
    );
    await client.post("/sign-up/email", {
      email: "ann@example.com",
      password: "correct-horse-battery",
      name: "Ann",
    });
    const other = createClient(auth);
    await other.post("/sign-up/email", {
      email: "bob@example.com",
      password: "correct-horse-battery",
      name: "Bob",
    });
    db.user.find((user) => user.email === "bob@example.com")!.telegramId = "42";

    const response = await client.post("/telegram/link", await widgetUser(42));

    expect(response.status).toBe(409);
    expect(response.json.code).toBe("TELEGRAM_ALREADY_LINKED_OTHER");
  });
});

describe("unlinking needs a fresh session", () => {
  it("answers 403 SESSION_NOT_FRESH for a session older than a day, keeping the account", async () => {
    // A stolen old session must not be able to strip the Telegram login.
    const { client, db } = createMemoryAuth(
      {},
      { emailAndPassword: { enabled: true } }
    );
    await client.post("/sign-up/email", {
      email: "ann@example.com",
      password: "correct-horse-battery",
      name: "Ann",
    });
    await client.post("/telegram/link", await widgetUser());
    db.session[0]!.createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const response = await client.post("/telegram/unlink", {});

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("SESSION_NOT_FRESH");
    expect(db.account.map((account) => account.providerId).sort()).toEqual([
      "credential",
      "telegram",
    ]);
  });
});

describe("maxAuthAge reaches the sign-in endpoints", () => {
  const NOW = 1_761_730_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  const signIn = {
    "/telegram/signin": async (authDate: number) =>
      signWidgetData({ id: 42, auth_date: authDate }),
    "/telegram/miniapp/signin": async (authDate: number) => ({
      initData: await signInitData({ id: 42 }, { auth_date: String(authDate) }),
    }),
  };

  it.each([
    ["/telegram/signin", undefined, 86_400],
    ["/telegram/signin", 60, 60],
    ["/telegram/miniapp/signin", undefined, 86_400],
    ["/telegram/miniapp/signin", 60, 60],
  ] as const)(
    "%s with maxAuthAge %s accepts data %i s old and not a second older",
    async (path, maxAuthAge, limit) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW * 1000);
      const { client } = createMemoryAuth({
        ...(maxAuthAge === undefined ? {} : { maxAuthAge }),
        miniApp: { enabled: true },
      });

      const tooOld = await client.post(
        path,
        await signIn[path](NOW - limit - 1)
      );
      const oldest = await client.post(path, await signIn[path](NOW - limit));

      expect(tooOld.status).toBe(401);
      expect(oldest.status).toBe(200);
    }
  );
});

describe("user mappers merge over the defaults", () => {
  it("keeps the Login Widget name and photo when mapTelegramDataToUser returns only an email", async () => {
    const { client, db } = createMemoryAuth({
      mapTelegramDataToUser: () => ({ email: "ann@example.com" }),
    });

    await client.post(
      "/telegram/signin",
      await signWidgetData({
        id: 42,
        first_name: "Ann",
        last_name: "Example",
        photo_url: "https://t.me/i/userpic/320/ann.jpg",
      })
    );

    expect(db.user[0]).toMatchObject({
      email: "ann@example.com",
      name: "Ann Example",
      image: "https://t.me/i/userpic/320/ann.jpg",
    });
  });

  it("keeps the Mini App name and photo when mapMiniAppDataToUser returns only an email", async () => {
    const { client, db } = createMemoryAuth({
      miniApp: {
        enabled: true,
        mapMiniAppDataToUser: () => ({ email: "ann@example.com" }),
      },
    });

    await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({
        id: 7,
        first_name: "Ann",
        last_name: "Example",
        photo_url: "https://t.me/i/userpic/320/ann.svg",
      }),
    });

    expect(db.user[0]).toMatchObject({
      email: "ann@example.com",
      name: "Ann Example",
      image: "https://t.me/i/userpic/320/ann.svg",
    });
  });
});
