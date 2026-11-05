// @vitest-environment node
import { defineRequestState } from "@better-auth/core/context";
import { betterAuth } from "better-auth";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AuthOptions,
  baseOptions,
  createClient,
  mockTelegramOIDC,
  signInWithTelegramOIDC,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";

let telegramMock: TelegramOIDCMock;
beforeEach(async () => {
  telegramMock = await mockTelegramOIDC();
});
afterEach(() => telegramMock.restore());

const member = {
  user_id: 42,
  user_name: "Ann",
  user_nick: "ann",
  role: "member",
};
type Member = typeof member;
const fields = {
  user_id: { type: "number", required: false, input: false, returned: true },
  user_name: { type: "string", required: false, input: false, returned: true },
  user_nick: { type: "string", required: false, input: false, returned: true },
  role: { type: "string", required: false, input: false, returned: true },
} as const;

// docs/server-owned-fields.md: lookup from verified provider data, then a
// trusted database hook. The mapper must retain Better Auth's input boundary.
function memberOptions(lookup: (telegramId: string) => Promise<Member | null>) {
  const verifiedMember = defineRequestState<Member | null>(() => null);
  return {
    user: {
      additionalFields: fields,
      async validateUserInfo({ source }) {
        const telegramId = source.oauth?.profile?.id;
        if (
          source.oauth?.providerId !== "telegram-oidc" ||
          typeof telegramId !== "string"
        ) {
          return { error: "telegram_required" };
        }
        const found = await lookup(telegramId);
        if (!found) {
          return { error: "not_a_member" };
        }
        await verifiedMember.set(found);
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before() {
            const found = await verifiedMember.get();
            if (!found) {
              return false;
            }
            return {
              data: {
                user_id: found.user_id,
                user_name: found.user_name,
                user_nick: found.user_nick,
                role: found.role,
              },
            };
          },
        },
      },
    },
  } satisfies Partial<AuthOptions>;
}

function authWith(extra: Partial<AuthOptions>) {
  return betterAuth(
    baseOptions(
      {
        loginWidget: false,
        oidc: {
          enabled: true,
          clientSecret: telegramMock.clientSecret,
          mapOIDCProfileToUser: async () => ({ role: "admin", user_id: 999 }),
        },
      },
      {
        ...extra,
        session: {
          expiresIn: 300,
          cookieCache: {
            enabled: true,
            strategy: "jwt",
            maxAge: 300,
            refreshCache: false,
          },
        },
      }
    )
  );
}

describe("server-owned user fields in stateless OIDC (issue #53)", () => {
  it("ignores mapper values for input:false, even with returned:true", async () => {
    const client = createClient(
      authWith({ user: { additionalFields: fields } })
    );
    const { location } = await signInWithTelegramOIDC(client, telegramMock);
    expect(location).toBe("/dashboard");
    const session = await client.get("/get-session");
    expect(session.json.user).not.toHaveProperty("role");
    expect(session.json.user).not.toHaveProperty("user_id");
  });

  it("carries trusted hook values in the JWT across instances and refuses client edits", async () => {
    const lookup = vi.fn(async () => member);
    const options = memberOptions(lookup);
    const client = createClient(authWith(options));
    const { callback, location } = await signInWithTelegramOIDC(
      client,
      telegramMock
    );
    expect(location).toBe("/dashboard");
    expect(lookup).toHaveBeenCalledExactlyOnceWith("8306595751");
    const cookies = callback.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0]!);
    const jwt = cookies.find((cookie) =>
      cookie.startsWith("better-auth.session_data=")
    )!;
    expect(
      decodeJwt(decodeURIComponent(jwt.slice(jwt.indexOf("=") + 1))).user
    ).toMatchObject(member);

    const restarted = createClient(authWith(options));
    const session = await restarted.request("/get-session", {
      headers: { cookie: cookies.join("; ") },
    });
    expect(session.json.user).toMatchObject(member);
    const edit = await client.post("/update-user", {
      role: "admin",
      user_id: 999,
    });
    expect(edit.status).toBe(400);
    expect(edit.json.code).toBe("FIELD_NOT_ALLOWED");
    expect((await client.get("/get-session")).json.user).toMatchObject(member);
  });

  it("refuses an unknown application user before issuing a session", async () => {
    const lookup = vi.fn(async (id: string) =>
      id === "8306595751" ? member : null
    );
    const auth = authWith(memberOptions(lookup));
    const accepted = createClient(auth);
    expect(
      (await signInWithTelegramOIDC(accepted, telegramMock)).location
    ).toBe("/dashboard");
    const rejected = createClient(auth);
    const result = await signInWithTelegramOIDC(
      rejected,
      telegramMock,
      telegramClaims({ sub: "another-subject", id: "456" })
    );
    expect(result.location).toContain("error=not_a_member");
    expect(rejected.hasSession()).toBe(false);
    expect((await rejected.get("/get-session")).json).toBeNull();
  });

  it("requires a new sign-in instead of rolling old member claims forward", async () => {
    const lookup = vi.fn(async () => member);
    const client = createClient(authWith(memberOptions(lookup)));
    expect((await signInWithTelegramOIDC(client, telegramMock)).location).toBe(
      "/dashboard"
    );
    const issuedAt = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(issuedAt + 250_000);
      expect((await client.get("/get-session")).json.user).toMatchObject(
        member
      );
      vi.setSystemTime(issuedAt + 301_000);
      expect((await client.get("/get-session")).json).toBeNull();
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps trusted member fields separate across overlapping sign-ins", async () => {
    const otherMember = { ...member, user_id: 84, role: "editor" };
    const options = memberOptions(async (id) =>
      id === "8306595751" ? member : otherMember
    );
    const populate = options.databaseHooks.user.create.before;
    let release!: () => void;
    const bothValidated = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrivals = 0;
    options.databaseHooks.user.create.before = async () => {
      arrivals += 1;
      if (arrivals === 2) {
        release();
      }
      // Both validation callbacks have stored their member before either
      // creation hook reads it. A shared mutable variable would mix them up.
      await bothValidated;
      return populate();
    };
    const auth = authWith(options);
    const ann = createClient(auth);
    const other = createClient(auth);
    const results = await Promise.all([
      signInWithTelegramOIDC(ann, telegramMock),
      signInWithTelegramOIDC(
        other,
        telegramMock,
        telegramClaims({ sub: "another-subject", id: "456" })
      ),
    ]);
    expect(results.map((result) => result.location)).toEqual([
      "/dashboard",
      "/dashboard",
    ]);
    expect((await ann.get("/get-session")).json.user).toMatchObject(member);
    expect((await other.get("/get-session")).json.user).toMatchObject(
      otherMember
    );
  });
});
