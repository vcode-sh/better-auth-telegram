// @vitest-environment node
import { setTimeout } from "node:timers/promises";
import { describe, expect, it, it as test, vi } from "vitest";
import {
  createMemoryAuth,
  createSqliteAuth,
  mockTelegramOIDC,
  signInitData,
  signInWithTelegramOIDC,
  signWidgetData,
  type TestClient,
} from "./testing/harness";

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

describe("database hook vetoes", () => {
  it.each([
    ["/telegram/signin", async () => await signWidgetData({ id: 42 })],
    [
      "/telegram/miniapp/signin",
      async () => ({ initData: await signInitData({ id: 42 }) }),
    ],
  ] as const)(
    "%s refuses sign-up and rolls back a vetoed account",
    async (path, body) => {
      const { client, rows, sqlite } = await createSqliteAuth(
        { miniApp: { enabled: true } },
        {
          databaseHooks: { account: { create: { before: async () => false } } },
        }
      );
      try {
        const response = await client.post(path, await body());

        expect(response.status).toBe(403);
        expect(response.json.code).toBe("ACCOUNT_CREATION_REJECTED");
        expect(client.hasSession()).toBe(false);
        expect(rows("user")).toHaveLength(0);
        expect(rows("account")).toHaveLength(0);
        expect(rows("session")).toHaveLength(0);
      } finally {
        sqlite.close();
      }
    }
  );

  it("does not claim an explicit link succeeded when account creation was vetoed", async () => {
    const { client, db } = createMemoryAuth(
      {},
      {
        emailAndPassword: { enabled: true },
        databaseHooks: {
          account: {
            create: {
              before: async (account) =>
                account.providerId === "telegram" ? false : undefined,
            },
          },
        },
      }
    );
    await signUp(client);

    const response = await client.post(
      "/telegram/link",
      await signWidgetData({ id: 42 })
    );

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("ACCOUNT_CREATION_REJECTED");
    expect(db.account.map((account) => account.providerId)).toEqual([
      "credential",
    ]);
    expect(db.user[0]!.telegramId ?? null).toBeNull();
  });

  it("does not claim an unlink succeeded when account deletion was vetoed", async () => {
    const { client, db } = createMemoryAuth(
      {},
      {
        emailAndPassword: { enabled: true },
        databaseHooks: { account: { delete: { before: async () => false } } },
      }
    );
    await signUp(client);
    await client.post("/telegram/link", await signWidgetData({ id: 42 }));

    const response = await client.post("/telegram/unlink", {});

    expect(response.status).toBe(403);
    expect(response.json.code).toBe("ACCOUNT_UNLINK_REJECTED");
    expect(
      db.account.some((account) => account.providerId === "telegram")
    ).toBe(true);
    expect(db.user[0]!.telegramId).toBe("42");
  });

  it("refuses an implicit link when the app vetoes its Telegram account", async () => {
    const oidc = await mockTelegramOIDC();
    try {
      const { client, db } = createMemoryAuth(
        { oidc: { enabled: true, clientSecret: oidc.clientSecret } },
        {
          databaseHooks: {
            account: {
              create: {
                before: async (account) =>
                  account.providerId === "telegram" ? false : undefined,
              },
            },
          },
        }
      );
      await signInWithTelegramOIDC(client, oidc);
      client.clearCookies();
      const sessionsBefore = db.session.length;

      const response = await client.post(
        "/telegram/signin",
        await signWidgetData({ id: 8_306_595_751 })
      );

      expect(response.status).toBe(403);
      expect(response.json.code).toBe("ACCOUNT_CREATION_REJECTED");
      expect(client.hasSession()).toBe(false);
      expect(db.account.map((account) => account.providerId)).toEqual([
        "telegram-oidc",
      ]);
      expect(db.session).toHaveLength(sessionsBefore);
    } finally {
      oidc.restore();
    }
  });

  it("does not treat a stale telegramId as sign-in proof when a user update was vetoed", async () => {
    const beforeUpdate = vi.fn(
      async (): Promise<false | undefined> => undefined
    );
    const { client, db } = createMemoryAuth(
      {},
      {
        emailAndPassword: { enabled: true },
        databaseHooks: {
          user: {
            update: {
              before: beforeUpdate,
            },
          },
        },
      }
    );
    await signUp(client);
    await client.post("/telegram/link", await signWidgetData({ id: 42 }));
    const oldUser = db.user[0]!.id;
    beforeUpdate.mockResolvedValue(false);

    const unlink = await client.post("/unlink-account", {
      accountId: db.account.find(
        (account) => account.providerId === "telegram"
      )!.id,
    });
    client.clearCookies();
    const login = await client.post(
      "/telegram/signin",
      await signWidgetData({ id: 42 })
    );

    expect(unlink.status).toBe(403);
    expect(unlink.json.code).toBe("IDENTITY_UPDATE_REJECTED");
    expect(db.user[0]!.telegramId).toBe("42");
    expect(
      db.account.filter(
        (account) =>
          account.userId === oldUser && account.providerId === "telegram"
      )
    ).toHaveLength(0);
    expect(login.status).toBe(200);
    expect(login.json.user.id).not.toBe(oldUser);
  });

  it("rolls back an explicit link if its identity update was vetoed", async () => {
    const { client, rows, sqlite } = await createSqliteAuth(
      {},
      {
        emailAndPassword: { enabled: true },
        databaseHooks: { user: { update: { before: async () => false } } },
      }
    );
    try {
      await signUp(client);
      const response = await client.post(
        "/telegram/link",
        await signWidgetData({ id: 42 })
      );

      expect(response.status).toBe(403);
      expect(response.json.code).toBe("IDENTITY_UPDATE_REJECTED");
      expect(rows("account").map((account) => account.providerId)).toEqual([
        "credential",
      ]);
      expect(rows("user")[0]!.telegramId).toBeNull();
    } finally {
      sqlite.close();
    }
  });
});

test("serializes different Telegram identities linked to the same user", async () => {
  let started = 0;
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { client, db } = createMemoryAuth(
    {},
    {
      emailAndPassword: { enabled: true },
      databaseHooks: {
        account: {
          create: {
            before: async (account) => {
              if (account.providerId === "telegram") {
                started += 1;
                if (started === 2) {
                  release();
                }
                // Before the fix both links reach this barrier. Once serialized,
                // the first must finish before the second can check the user again.
                await Promise.race([bothStarted, setTimeout(100)]);
              }
            },
          },
        },
      },
    }
  );
  await signUp(client);
  const payloads = await Promise.all([
    signWidgetData({ id: 42 }),
    signWidgetData({ id: 43 }),
  ]);

  const responses = await Promise.all(
    payloads.map((body) => client.post("/telegram/link", body))
  );

  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  const accounts = db.account.filter(
    (account) => account.providerId === "telegram"
  );
  expect(accounts).toHaveLength(1);
  expect(db.user[0]!.telegramId).toBe(accounts[0]!.accountId);
});
