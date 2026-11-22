// @vitest-environment node
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { expect, onTestFinished, it as test } from "vitest";
import { telegram, validateTelegramBotOwnership } from "./index";
import { BASE_URL, BOT_TOKEN } from "./testing/constants";
import {
  createClient,
  createMemoryAuth,
  type MemoryDB,
  mockTelegramOIDC,
  signInWithTelegramOIDC,
  telegramClaims,
} from "./testing/harness";

const telegramId = 8_306_595_751;
const subject = "12224742808376279442";

function createBotAuth(clientSecret: string) {
  const db: MemoryDB = { user: [], account: [], session: [], verification: [] };
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "better-auth-telegram-test-secret-0123456789abcdef",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    user: { validateUserInfo: validateTelegramBotOwnership },
    account: {
      accountLinking: {
        trustedProviders: ["telegram-oidc"],
        allowDifferentEmails: true,
      },
    },
    plugins: [
      telegram({
        botProvisioning: true,
        botToken: BOT_TOKEN,
        loginWidget: false,
        oidc: { enabled: true, clientSecret },
      }),
    ],
  });
  const provision = auth.api.provisionTelegramUser;
  if (!provision) {
    throw new Error("Bot provisioning is unavailable");
  }
  return { provision, client: createClient(auth), db };
}

function createBotOnlyAuth(autoCreateUser = true) {
  const db: MemoryDB = { user: [], account: [], session: [], verification: [] };
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "better-auth-telegram-test-secret-0123456789abcdef",
    database: memoryAdapter(db),
    plugins: [
      telegram({
        botProvisioning: true,
        autoCreateUser,
        botToken: BOT_TOKEN,
        loginWidget: false,
      }),
    ],
  });
  const provision = auth.api.provisionTelegramUser;
  if (!provision) {
    throw new Error("Bot provisioning is unavailable");
  }
  return { provision, auth, db };
}

test("provisions once without a session and signs in through OIDC as the same user", async () => {
  const provider = await mockTelegramOIDC();
  onTestFinished(() => provider.restore());
  const { provision, client, db } = createBotAuth(provider.clientSecret);

  const first = await provision({
    body: { telegramId, firstName: "Ann", lastName: "Example" },
  });
  expect(
    await provision({ body: { telegramId, firstName: "Updated" } })
  ).toEqual(first);
  expect(db.user).toHaveLength(1);
  expect(db.user[0]?.name).toBe("Ann Example");
  expect(db.session).toHaveLength(0);
  expect(db.account).toMatchObject([
    {
      providerId: "telegram",
      accountId: String(telegramId),
      userId: first.userId,
    },
  ]);

  const { location } = await signInWithTelegramOIDC(client, provider);
  expect(location).toBe("/dashboard");
  expect((await client.get("/get-session")).json.user.id).toBe(first.userId);
  expect(db.user[0]?.name).toBe("Ann Example");
  expect(db.user).toHaveLength(1);
  expect(db.account).toHaveLength(2);
  expect(db.account).toContainEqual(
    expect.objectContaining({
      providerId: "telegram-oidc",
      accountId: subject,
      userId: first.userId,
    })
  );
});

test("does not let a signed-in user link a Telegram identity owned by a bot user", async () => {
  const provider = await mockTelegramOIDC();
  onTestFinished(() => provider.restore());
  const { provision, client, db } = createBotAuth(provider.clientSecret);
  const owner = await provision({ body: { telegramId, firstName: "Ann" } });
  expect(db.user[0]?.name).toBe("Ann");
  const signup = await client.post("/sign-up/email", {
    email: "other@example.com",
    password: "correct-horse-battery",
    name: "Other",
  });
  expect(signup.status).toBe(200);
  expect(signup.json.user.id).not.toBe(owner.userId);

  const link = await client.post("/link-social", {
    provider: "telegram-oidc",
    callbackURL: "/settings",
  });
  expect(link.status).toBe(200);
  const callback = await client.get(
    provider.authorize(link.json.url, telegramClaims())
  );
  expect(callback.headers.get("location")).toContain(
    "TELEGRAM_ALREADY_LINKED_OTHER"
  );
  expect(
    db.account.some((account) => account.providerId === "telegram-oidc")
  ).toBe(false);

  const retry = await client.post("/link-social", {
    provider: "telegram-oidc",
    callbackURL: "/settings",
  });
  expect(retry.status).toBe(200);
  const unusedTelegramId = 8_306_595_752;
  const allowed = await client.get(
    provider.authorize(
      retry.json.url,
      telegramClaims({
        sub: "12224742808376279443",
        id: String(unusedTelegramId),
      })
    )
  );
  expect(allowed.headers.get("location")).toBe("/settings");
  expect(
    await provision({
      body: { telegramId: unusedTelegramId, firstName: "Telegram name" },
    })
  ).toEqual({ userId: signup.json.user.id });
  expect(db.user).toHaveLength(2);
  expect((await client.get("/get-session")).json.user.email).toBe(
    "other@example.com"
  );
  expect((await client.get("/get-session")).json.user.name).toBe("Other");
});

test("leaves the provisioning endpoint unregistered when botProvisioning is off", () => {
  const { auth } = createMemoryAuth();
  expect(
    (auth.api as Record<string, unknown>).provisionTelegramUser
  ).toBeUndefined();
});

test("rejects malformed provisioning data without writing anything", async () => {
  const { provision, db } = createBotOnlyAuth();

  await Promise.all(
    [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7"].map((badId) =>
      expect(
        provision({ body: { telegramId: badId, firstName: "Ann" } as never })
      ).rejects.toMatchObject({
        body: { code: "BOT_PROVISIONING_ID_REQUIRED" },
      })
    )
  );
  await Promise.all(
    [
      { telegramId },
      { telegramId, firstName: "  " },
      { telegramId, firstName: 42 },
      { telegramId, firstName: "Ann", lastName: 42 },
    ].map((body) =>
      expect(provision({ body: body as never })).rejects.toMatchObject({
        body: { code: "BOT_PROVISIONING_NAME_REQUIRED" },
      })
    )
  );
  expect(db.user).toHaveLength(0);
  expect(db.account).toHaveLength(0);
});

test("refuses a provisioning call that carries a request", async () => {
  const { provision, db } = createBotOnlyAuth();

  const response = await provision({
    body: { telegramId, firstName: "Ann" },
    request: new Request("https://example.com/provision"),
  } as never);
  expect(response).toHaveProperty("status", 403);
  expect(await (response as unknown as Response).json()).toMatchObject({
    code: "BOT_PROVISIONING_SERVER_ONLY",
  });
  expect(db.user).toHaveLength(0);
  expect(db.account).toHaveLength(0);
});

test("does not create a user when autoCreateUser is false", async () => {
  const { provision, db } = createBotOnlyAuth(false);

  await expect(
    provision({ body: { telegramId, firstName: "Ann" } })
  ).rejects.toMatchObject({ body: { code: "USER_CREATION_DISABLED" } });
  expect(db.user).toHaveLength(0);
  expect(db.account).toHaveLength(0);
});
