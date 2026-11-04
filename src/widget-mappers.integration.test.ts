// @vitest-environment node
/**
 * Login Widget and Mini App flows against a real Better Auth instance.
 */
import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import {
  createClient,
  createMemoryAuth,
  createSqliteAuth,
  signInitData,
  signWidgetData,
} from "./testing/harness";

const widgetUser = (id = 42, extra: Record<string, string | number> = {}) =>
  signWidgetData({ id, first_name: "Ann", username: "ann", ...extra });

describe("what user mappers can set", () => {
  it("neither the user id nor emailVerified", async () => {
    const { client, db } = createMemoryAuth({
      mapTelegramDataToUser: () => ({
        id: "chosen-id",
        email: "ann@example.com",
        emailVerified: true,
      }),
    });

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(200);
    expect(db.user[0]!.id).not.toBe("chosen-id");
    expect(db.user[0]).toMatchObject({
      email: "ann@example.com",
      emailVerified: false,
    });
  });

  // Catches: a permanent dead end. The user who unlinked keeps the
  // placeholder email (unique), so the Telegram user could never sign up
  // again; they get a new user with another reserved placeholder instead.
  it("lets a Telegram user sign up again after unlinking from a user that kept the placeholder", async () => {
    const { client, rows } = await createSqliteAuth(
      {},
      { account: { accountLinking: { allowUnlinkingAll: true } } }
    );
    const first = await client.post("/telegram/signin", await widgetUser());
    await client.post("/telegram/unlink", {});
    client.clearCookies();

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(200);
    expect(response.json.user.id).not.toBe(first.json.user.id);
    expect(response.json.user.telegramId).toBe("42");
    expect(response.json.user.email).toMatch(
      /^42\.[a-z0-9]+@telegram\.placeholder\.invalid$/u
    );
    expect(rows("user")).toHaveLength(2);
  });

  // A placeholder variant is still reserved for that Telegram user.
  it("refuses an email sign-up with another user's placeholder variant", async () => {
    const { client, rows } = await createSqliteAuth(
      {},
      { emailAndPassword: { enabled: true } }
    );

    const response = await client.post("/sign-up/email", {
      email: "42.abc@telegram.placeholder.invalid",
      password: "correct-horse-battery",
      name: "Squatter",
    });

    expect(response.status).toBe(400);
    expect(response.json.code).toBe("FAILED_TO_CREATE_USER");
    expect(rows("user")).toHaveLength(0);
    expect(rows("account")).toHaveLength(0);
    expect(rows("session")).toHaveLength(0);
    expect(client.hasSession()).toBe(false);
  });

  // Better Auth's /sign-up/email answers 422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL.
  it("answers 422 instead of a bare 500 for an email another user has", async () => {
    const { auth, client, rows } = await createSqliteAuth(
      { mapTelegramDataToUser: () => ({ email: "ann@example.com" }) },
      { emailAndPassword: { enabled: true } }
    );
    await createClient(auth).post("/sign-up/email", {
      email: "ann@example.com",
      password: "correct-horse-battery",
      name: "Ann",
    });

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(422);
    expect(response.json.code).toBe("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");
    expect(rows("user")).toHaveLength(1);
    expect(rows("account").map((account) => account.providerId)).toEqual([
      "credential",
    ]);
  });
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

// #53: apps write async mappers (a database lookup, say), as Better Auth
// allows for mapProfileToUser. Catches: the mapper's Promise spread as if it
// were the profile, which dropped every mapped field and let a rejection
// escape instead of refusing the sign-in.
describe("async user mappers", () => {
  const appUser = {
    user: {
      additionalFields: { memberId: { type: "number", required: true } },
    },
  } as const;
  const lookUp = async (id: number) => {
    await Promise.resolve();
    return { memberId: id * 10, name: "Ann From The App" };
  };
  const refuse = async (): Promise<Record<string, unknown>> => {
    await Promise.resolve();
    throw new APIError("FORBIDDEN", { message: "NOT_A_MEMBER" });
  };

  it("creates a Login Widget user with the mapped fields", async () => {
    const { client, db } = createMemoryAuth(
      { mapTelegramDataToUser: (data) => lookUp(data.id) },
      appUser
    );

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(200);
    expect(db.user[0]).toMatchObject({
      memberId: 420,
      name: "Ann From The App",
    });
  });

  it("refuses a Login Widget sign-in when the mapper throws", async () => {
    const { client, db } = createMemoryAuth(
      { mapTelegramDataToUser: refuse },
      appUser
    );

    const response = await client.post("/telegram/signin", await widgetUser());

    expect(response.status).toBe(403);
    expect(response.text).toContain("NOT_A_MEMBER");
    expect(client.hasSession()).toBe(false);
    expect(db.user).toHaveLength(0);
  });

  it("creates a Mini App user with the mapped fields", async () => {
    const { client, db } = createMemoryAuth(
      {
        miniApp: {
          enabled: true,
          mapMiniAppDataToUser: (user) => lookUp(user.id),
        },
      },
      appUser
    );

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7 }),
    });

    expect(response.status).toBe(200);
    expect(db.user[0]).toMatchObject({
      memberId: 70,
      name: "Ann From The App",
    });
  });

  it("refuses a Mini App sign-in when the mapper throws", async () => {
    const { client, db } = createMemoryAuth(
      { miniApp: { enabled: true, mapMiniAppDataToUser: refuse } },
      appUser
    );

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7 }),
    });

    expect(response.status).toBe(403);
    expect(client.hasSession()).toBe(false);
    expect(db.user).toHaveLength(0);
  });
});
