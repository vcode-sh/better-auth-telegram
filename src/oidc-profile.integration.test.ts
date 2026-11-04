// @vitest-environment node
/**
 * Telegram OIDC against a real Better Auth instance and a fake
 * oauth.telegram.org (see src/testing/harness.ts).
 */
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  baseOptions,
  createClient,
  createMemoryAuth,
  mockTelegramOIDC,
  signInWithTelegramOIDC,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";
import type { TelegramOIDCClaims } from "./types";

let telegramMock: TelegramOIDCMock;

beforeEach(async () => {
  telegramMock = await mockTelegramOIDC();
});

afterEach(() => {
  telegramMock.restore();
});

const oidc = () => ({
  oidc: { enabled: true, clientSecret: telegramMock.clientSecret },
});

describe("oidc.updateUserInfoOnSignIn", () => {
  const nicknameUser = {
    user: {
      additionalFields: { nickname: { type: "string", required: false } },
    },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
  } as const;
  const withMapper = (extra: Record<string, unknown> = {}) => ({
    loginWidget: false,
    oidc: {
      ...oidc().oidc,
      mapOIDCProfileToUser: (claims: { preferred_username?: string }) => ({
        nickname: claims.preferred_username,
      }),
      ...extra,
    },
  });

  async function signInTwice(extra: Record<string, unknown>) {
    const { client, db } = createMemoryAuth(withMapper(extra), nicknameUser);
    await signInWithTelegramOIDC(client, telegramMock);
    db.user[0]!.email = "ann@example.com";
    db.user[0]!.emailVerified = true;
    client.clearCookies();
    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ name: "Ann Renamed", preferred_username: "ann_new" })
    );
    const session = await client.get("/get-session");
    return { db, location, session };
  }

  it("is off by default: returning users keep the values they signed up with", async () => {
    const { db } = await signInTwice({});

    expect(db.user[0]).toMatchObject({ name: "Ann Example", nickname: "ann" });
  });

  it("writes the mapped profile onto returning users and their session", async () => {
    const { db, location, session } = await signInTwice({
      updateUserInfoOnSignIn: true,
    });

    expect(location).toBe("/dashboard");
    expect(db.user[0]).toMatchObject({
      name: "Ann Renamed",
      nickname: "ann_new",
    });
    expect(session.json.user).toMatchObject({
      name: "Ann Renamed",
      nickname: "ann_new",
    });
  });

  it("signs in with the stored profile when a hook refuses the update", async () => {
    const { client, db } = createMemoryAuth(
      withMapper({ updateUserInfoOnSignIn: true }),
      {
        ...nicknameUser,
        databaseHooks: { user: { update: { before: async () => false } } },
      }
    );
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();

    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ name: "Ann Renamed" })
    );

    expect(location).toBe("/dashboard");
    expect(db.user[0]!.name).toBe("Ann Example");
  });

  it("signs in with the stored profile when a field validator refuses it", async () => {
    const shortText = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (value: unknown) =>
          String(value).length > 4
            ? { issues: [{ message: "too long" }] }
            : { value },
      },
    };
    const { client, db } = createMemoryAuth(
      withMapper({ updateUserInfoOnSignIn: true }),
      {
        ...nicknameUser,
        user: {
          additionalFields: {
            nickname: {
              type: "string",
              required: false,
              validator: { input: shortText },
            },
          },
        },
      }
    );
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();

    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ preferred_username: "ann_new" })
    );

    expect(location).toBe("/dashboard");
    expect(db.user[0]!.nickname).toBe("ann");
  });

  it("writes nothing when the profile is unchanged", async () => {
    const before = vi.fn();
    const { client } = createMemoryAuth(
      {
        loginWidget: false,
        oidc: {
          ...oidc().oidc,
          updateUserInfoOnSignIn: true,
          mapOIDCProfileToUser: () => ({
            joinedAt: new Date(0),
            settings: { theme: "dark" },
          }),
        },
      },
      {
        user: {
          additionalFields: {
            joinedAt: { type: "date", required: false },
            settings: { type: "json", required: false },
          },
        },
        databaseHooks: { user: { update: { before } } },
      }
    );
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();

    await signInWithTelegramOIDC(client, telegramMock);

    expect(before).not.toHaveBeenCalled();
  });

  // Better Auth writes its own profile updates only after validateUserInfo
  // allowed the sign-in (link-account.mjs).
  it("leaves a user the app refuses to sign in untouched", async () => {
    const { client, db } = createMemoryAuth(
      withMapper({ updateUserInfoOnSignIn: true }),
      {
        ...nicknameUser,
        user: {
          ...nicknameUser.user,
          validateUserInfo: ({ source }: { source: { action: string } }) =>
            source.action === "sign-in" ? { error: "banned" } : undefined,
        },
      }
    );
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();

    const { location } = await signInWithTelegramOIDC(
      client,
      telegramMock,
      telegramClaims({ name: "Ann Renamed", preferred_username: "ann_new" })
    );

    expect(location).toContain("error=banned");
    expect(db.user[0]).toMatchObject({ name: "Ann Example", nickname: "ann" });
  });

  // Better Auth's overrideUserInfoOnSignIn would put the placeholder back.
  it("never changes the email or its verification", async () => {
    const { db } = await signInTwice({
      updateUserInfoOnSignIn: true,
      mapOIDCProfileToUser: () => ({ email: "mapped@example.com" }),
    });

    expect(db.user[0]).toMatchObject({
      email: "ann@example.com",
      emailVerified: true,
    });
  });
});

// #53: Better Auth's own providers await mapProfileToUser, so apps write
// async mappers (a database lookup, say). Catches: the mapper's Promise
// spread as if it were the profile, which dropped every mapped field and let
// a rejection escape instead of refusing the sign-in.
describe("an async mapOIDCProfileToUser", () => {
  const appUser = {
    user: {
      additionalFields: {
        user_id: { type: "number", required: true },
        telegram_id: { type: "string", required: false },
      },
    },
  } as const;
  const asyncMapper = (
    map: (claims: TelegramOIDCClaims) => Promise<Record<string, unknown>>
  ) => ({
    loginWidget: false,
    oidc: { ...oidc().oidc, mapOIDCProfileToUser: map },
  });
  const lookUpAppUser = async (claims: TelegramOIDCClaims) => {
    await Promise.resolve();
    return { user_id: 42, telegram_id: claims.id, name: "Ann From The App" };
  };

  it("creates the user with the mapped fields", async () => {
    const { client, db } = createMemoryAuth(
      asyncMapper(lookUpAppUser),
      appUser
    );

    const { location } = await signInWithTelegramOIDC(client, telegramMock);

    expect(location).toBe("/dashboard");
    expect(db.user[0]).toMatchObject({
      user_id: 42,
      telegram_id: "8306595751",
      name: "Ann From The App",
    });
  });

  // The setup from #53: no database, the JWT cookie is the session.
  it("puts the mapped fields into a stateless JWT session", async () => {
    const auth = betterAuth(
      baseOptions(asyncMapper(lookUpAppUser), {
        ...appUser,
        session: {
          cookieCache: {
            enabled: true,
            maxAge: 300,
            strategy: "jwt",
            refreshCache: true,
          },
        },
      })
    );
    const client = createClient(auth);

    const { location } = await signInWithTelegramOIDC(client, telegramMock);
    const session = await client.get("/get-session");

    expect(location).toBe("/dashboard");
    expect(session.json.user).toMatchObject({
      user_id: 42,
      telegram_id: "8306595751",
      name: "Ann From The App",
    });
  });

  it("refuses the sign-in when the mapper throws", async () => {
    const { client, db } = createMemoryAuth(
      asyncMapper(async () => {
        await Promise.resolve();
        throw new APIError("FORBIDDEN", { message: "USER_NOT_REGISTERED" });
      }),
      appUser
    );

    const { callback } = await signInWithTelegramOIDC(client, telegramMock);

    expect(callback.status).toBe(403);
    expect(callback.text).toContain("USER_NOT_REGISTERED");
    expect(client.hasSession()).toBe(false);
    expect(db.user).toHaveLength(0);
  });

  it("updates returning users with oidc.updateUserInfoOnSignIn", async () => {
    let appUserId = 42;
    const { client, db } = createMemoryAuth(
      {
        loginWidget: false,
        oidc: {
          ...oidc().oidc,
          updateUserInfoOnSignIn: true,
          mapOIDCProfileToUser: async () => {
            await Promise.resolve();
            return { user_id: appUserId };
          },
        },
      },
      appUser
    );
    await signInWithTelegramOIDC(client, telegramMock);
    client.clearCookies();
    appUserId = 43;

    await signInWithTelegramOIDC(client, telegramMock);

    expect(db.user[0]!.user_id).toBe(43);
  });
});
