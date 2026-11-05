// @vitest-environment node
import { defineRequestState } from "@better-auth/core/context";
import { betterAuth } from "better-auth";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  baseOptions,
  createClient,
  mockTelegramOIDC,
  signInWithTelegramOIDC,
  type TelegramOIDCMock,
} from "./testing/harness";

let provider: TelegramOIDCMock;
beforeEach(async () => {
  provider = await mockTelegramOIDC();
});
afterEach(() => provider.restore());

const fields = {
  role: { type: "string", required: false, input: false, returned: true },
  user_id: { type: "number", required: false, input: false, returned: true },
} as const;

function setup() {
  const member = defineRequestState<{ role: string; user_id: number } | null>(
    () => null
  );
  const application = { role: "member", denied: false };
  const options = baseOptions(
    {
      loginWidget: false,
      oidc: { enabled: true, clientSecret: provider.clientSecret },
    },
    {
      user: {
        additionalFields: fields,
        async validateUserInfo({ source }) {
          if (
            source.oauth?.providerId !== "telegram-oidc" ||
            typeof source.oauth.profile?.id !== "string" ||
            application.denied
          ) {
            return { error: "not_a_member" };
          }
          await member.set({ role: application.role, user_id: 42 });
        },
      },
      session: {
        cookieCache: { enabled: true, strategy: "jwt", refreshCache: false },
        additionalFields: fields,
      },
      databaseHooks: {
        user: {
          create: {
            async before() {
              const found = await member.get();
              if (!found) {
                return false;
              }
              return { data: { role: found.role, user_id: found.user_id } };
            },
          },
        },
        session: {
          create: {
            async before() {
              const found = await member.get();
              if (!found) {
                return false;
              }
              return { data: { role: found.role, user_id: found.user_id } };
            },
          },
        },
      },
    }
  );
  const auth = betterAuth(options);
  return { auth, application, client: createClient(auth), options };
}

function jwtCookie(headers: Headers) {
  const cookies = headers
    .getSetCookie()
    .map((rawCookie) => rawCookie.split(";")[0]!);
  const cookie = cookies.find((value) =>
    value.startsWith("better-auth.session_data=")
  )!;
  return {
    cookies,
    payload: decodeJwt(
      decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1))
    ),
  };
}

describe("fresh server-owned session claims without a database", () => {
  it("refreshes per-login claims while the same user's creation snapshot stays unchanged", async () => {
    const { client, application } = setup();
    expect((await signInWithTelegramOIDC(client, provider)).location).toBe(
      "/dashboard"
    );
    const first = (await client.get("/get-session")).json;
    expect(first.user).toMatchObject({ role: "member", user_id: 42 });
    expect(first.session).toMatchObject({ role: "member", user_id: 42 });
    client.clearCookies();
    application.role = "editor";

    const second = await signInWithTelegramOIDC(client, provider);
    const current = (await client.get("/get-session")).json;
    expect(second.location).toBe("/dashboard");
    expect(current.user).toMatchObject({
      id: first.user.id,
      role: "member",
      user_id: 42,
    });
    expect(current.session).toMatchObject({ role: "editor", user_id: 42 });
    const { payload } = jwtCookie(second.callback.headers);
    expect(payload.user).toMatchObject({
      id: first.user.id,
      role: "member",
      user_id: 42,
    });
    expect(payload.session).toMatchObject({ role: "editor", user_id: 42 });
  });

  it("keeps the issued session claims readable on another auth instance", async () => {
    const { client, options } = setup();
    const result = await signInWithTelegramOIDC(client, provider);
    expect(result.location).toBe("/dashboard");
    const { cookies } = jwtCookie(result.callback.headers);
    const reader = createClient(betterAuth(options));
    const response = await reader.request("/get-session", {
      headers: { cookie: cookies.join("; ") },
    });
    expect(response.json.session).toMatchObject({
      role: "member",
      user_id: 42,
    });
  });

  it("refuses generic API edits of the server-owned user and session fields", async () => {
    const { client } = setup();
    expect((await signInWithTelegramOIDC(client, provider)).location).toBe(
      "/dashboard"
    );
    const edits = await Promise.all(
      ["/update-session", "/update-user"].map((endpoint) =>
        client.post(endpoint, { role: "admin", user_id: 999 })
      )
    );
    for (const edit of edits) {
      expect(edit.status).toBe(400);
      expect(edit.json.code).toBe("FIELD_NOT_ALLOWED");
    }
    const current = (await client.get("/get-session")).json;
    expect(current.user).toMatchObject({ role: "member", user_id: 42 });
    expect(current.session).toMatchObject({ role: "member", user_id: 42 });
  });

  it("creates no new session when the returning user is refused by the application", async () => {
    const { auth, client, application } = setup();
    expect((await signInWithTelegramOIDC(client, provider)).location).toBe(
      "/dashboard"
    );
    const ctx = await auth.$context;
    const before = await ctx.adapter.count({ model: "session" });
    client.clearCookies();
    application.denied = true;

    const refused = await signInWithTelegramOIDC(client, provider);
    expect(refused.location).toContain("error=not_a_member");
    expect(await ctx.adapter.count({ model: "session" })).toBe(before);
    expect(client.hasSession()).toBe(false);
    expect((await client.get("/get-session")).json).toBeNull();
  });
});
