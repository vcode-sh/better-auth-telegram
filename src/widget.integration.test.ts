// @vitest-environment node
import { APIError } from "better-auth/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClient,
  createMemoryAuth,
  createSqliteAuth,
  type MemoryDB,
  signInitData,
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

  it("returns the same user on the next sign-in and refreshes the username", async () => {
    const { client, db } = createMemoryAuth();
    const first = await client.post("/telegram/signin", await widgetUser());
    expect(first.status).toBe(200);
    client.clearCookies();

    const response = await client.post(
      "/telegram/signin",
      await widgetUser(42, { username: "ann_new" })
    );

    expect(response.status).toBe(200);
    expect(response.json.user.id).toBe(first.json.user.id);
    expect(db.user).toHaveLength(1);
    expect(db.user[0]!.telegramUsername).toBe("ann_new");
    expect(db.account[0]!.telegramUsername).toBe("ann_new");
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
    expect(response.json.code).toBe("INVALID_AUTHENTICATION");
    expect(db.user).toHaveLength(0);
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  it("answers 404 when auto-create is disabled", async () => {
    const { client, db } = createMemoryAuth({ autoCreateUser: false });

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(404);
    expect(response.json.code).toBe("USER_CREATION_DISABLED");
    expect(db.user).toHaveLength(0);
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
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

  // Catches: unlink removing only the first row while a duplicate (left by
  // v2, or by a cross-server race) keeps proving telegramId, so the
  // "unlinked" Telegram user can still sign in.
  it("removes every Telegram row on unlink, including duplicates", async () => {
    const { client, db } = await signedUpClient();
    await client.post("/telegram/link", await widgetUser());
    const original = db.account.find(
      (account) => account.providerId === "telegram"
    )!;
    db.account.push({ ...original, id: "duplicate-telegram-row" });

    const response = await client.post("/telegram/unlink", {});
    const userId = db.user[0]!.id;
    client.clearCookies();
    const again = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(200);
    expect(
      db.account
        .filter((account) => account.providerId === "telegram")
        .map((account) => account.userId)
    ).not.toContain(userId);
    expect(db.user.find((user) => user.id === userId)!.telegramId).toBeNull();
    expect(again.json.user.id).not.toBe(userId);
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

describe("Login Widget request validation", () => {
  it("answers 400 for a payload without the signed fields", async () => {
    const { client } = createMemoryAuth();

    const response = await client.post("/telegram/signin", { id: 42 });

    expect(response.status).toBe(400);
    expect(response.json.code).toBe("INVALID_AUTH_DATA");
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
    const { client, db } = createMemoryAuth({ allowUserToLink: false });
    await client.post("/telegram/signin", await widgetUser());

    const response = await client.post("/telegram/link", await widgetUser(43));

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("LINKING_DISABLED");
    expect(db.account.map((account) => account.accountId)).toEqual(["42"]);
    expect(db.user[0]!.telegramId).toBe("42");
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

describe("Telegram account bookkeeping", () => {
  it.each([undefined, "ann"])(
    "signs in without rewriting unchanged user/account metadata (username %s)",
    async (username) => {
      const userUpdate = vi.fn();
      const accountUpdate = vi.fn();
      // SQL stores a missing username as null, unlike the memory adapter.
      const { client, rows, sqlite } = await createSqliteAuth(
        {},
        {
          databaseHooks: {
            user: { update: { before: userUpdate } },
            account: { update: { before: accountUpdate } },
          },
        }
      );
      try {
        const payload = await signWidgetData({
          id: 42,
          first_name: "Ann",
          ...(username === undefined ? {} : { username }),
        });
        const first = await client.post("/telegram/signin", payload);
        expect(first.status).toBe(200);
        const [storedUser] = rows("user");
        const [storedAccount] = rows("account");
        client.clearCookies();

        const again = await client.post("/telegram/signin", payload);
        const session = await client.get("/get-session");

        expect(again.status).toBe(200);
        expect(session.json.user.id).toBe(first.json.user.id);
        expect(rows("user")).toEqual([storedUser]);
        expect(rows("account")).toEqual([storedAccount]);
        expect(userUpdate).not.toHaveBeenCalled();
        expect(accountUpdate).not.toHaveBeenCalled();
      } finally {
        sqlite.close();
      }
    }
  );

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

describe("a database hook vetoing the session", () => {
  it("answers 401 FAILED_TO_CREATE_SESSION without a session cookie", async () => {
    const { client } = createMemoryAuth(
      {},
      { databaseHooks: { session: { create: { before: async () => false } } } }
    );

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(401);
    expect(response.json.code).toBe("FAILED_TO_CREATE_SESSION");
    expect(client.hasSession()).toBe(false);
  });
});

describe("another server creating the same Telegram user first", () => {
  // Server B signs the user up while server A is creating them; on SQL the
  // unique user.email makes A's insert fail. The hook stands in for that
  // database error, which the memory adapter can't raise.
  function racingServers(failure: () => Error) {
    const db: MemoryDB = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const serverB = createMemoryAuth({}, {}, db);
    let raced = false;
    const serverA = createMemoryAuth(
      {},
      {
        databaseHooks: {
          user: {
            create: {
              async before() {
                if (!raced) {
                  raced = true;
                  await serverB.client.post(
                    "/telegram/signin",
                    await widgetUser()
                  );
                  throw failure();
                }
              },
            },
          },
        },
      },
      db
    );
    return { serverA, db };
  }

  it("signs in as the user the other server created", async () => {
    const { serverA, db } = racingServers(
      () =>
        new Error(
          'duplicate key value violates unique constraint "user_email_key"'
        )
    );

    const response = await serverA.client.post(
      "/telegram/signin",
      await widgetUser()
    );

    expect(response.status).toBe(200);
    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(1);
    expect(response.json.user.id).toBe(db.user[0]!.id);
  });

  it("does not turn an application refusal into sign-in after another server created the user", async () => {
    const { serverA, db } = racingServers(
      () =>
        new APIError("FORBIDDEN", {
          code: "INVITE_REVOKED",
          message: "Invite revoked",
        })
    );

    const response = await serverA.client.post(
      "/telegram/signin",
      await widgetUser()
    );

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("INVITE_REVOKED");
    expect(serverA.client.hasSession()).toBe(false);
    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(1);
    // Only server B's permitted sign-in may have created a session.
    expect(db.session).toHaveLength(1);
  });

  it("still reports a database error when no Telegram user was created", async () => {
    const { client, db } = createMemoryAuth(
      {},
      {
        databaseHooks: {
          user: {
            create: {
              before() {
                throw new Error("connection reset");
              },
            },
          },
        },
      }
    );

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(500);
    expect(client.hasSession()).toBe(false);
    expect(db.user).toHaveLength(0);
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
