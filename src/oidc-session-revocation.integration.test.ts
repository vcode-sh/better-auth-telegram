// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryAuth,
  mockTelegramOIDC,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";

let issuer: TelegramOIDCMock;
beforeEach(async () => {
  issuer = await mockTelegramOIDC();
});
afterEach(() => issuer.restore());

async function signedInUser() {
  const fixture = createMemoryAuth(
    {
      loginWidget: false,
      oidc: { enabled: true, clientSecret: issuer.clientSecret },
    },
    {
      emailAndPassword: { enabled: true },
      session: { cookieCache: { enabled: true, maxAge: 300 } },
      account: {
        accountLinking: {
          trustedProviders: ["telegram-oidc"],
          allowDifferentEmails: true,
        },
      },
    }
  );
  const signup = await fixture.client.post("/sign-up/email", {
    email: "ann@example.com",
    password: "correct-horse-battery",
    name: "Ann",
  });
  if (signup.status !== 200) {
    throw new Error(`Sign-up failed: ${signup.status} ${signup.text}`);
  }
  const session = await fixture.client.get("/get-session");
  if (session.json?.user.id !== fixture.db.user[0]!.id) {
    throw new Error("Sign-up did not establish the expected session");
  }
  const ctx = await fixture.auth.$context;
  return {
    ...fixture,
    revoke: () => ctx.internalAdapter.deleteSession(session.json.session.token),
  };
}

describe("Telegram OIDC links require a live initiating session", () => {
  it.each(["redirect", "id token"] as const)(
    "refuses %s linking from a revoked session still in the cookie cache",
    async (flow) => {
      const { client, db, revoke } = await signedInUser();
      const before = structuredClone(db.account);
      await revoke();
      expect(db.session).toHaveLength(0);

      const response = await client.post("/link-social", {
        provider: "telegram-oidc",
        callbackURL: "/settings",
        ...(flow === "id token"
          ? {
              idToken: {
                token: await issuer.sign({ ...telegramClaims(), nonce: "n" }),
                nonce: "n",
              },
            }
          : {}),
      });

      expect(response.status).toBe(401);
      expect(db.account).toEqual(before);
      expect(db.session).toHaveLength(0);
      expect(issuer.tokenRequests).toHaveLength(0);
    }
  );

  it.each([
    [false, "/settings", 1],
    [true, "error=unable_to_link_account", 0],
  ] as const)(
    "only completes a redirect link while its initiating session is live (revoked: %s)",
    async (revoked, location, linkedAccounts) => {
      const { client, db, revoke } = await signedInUser();
      const before = structuredClone(db.account);
      const start = await client.post("/link-social", {
        provider: "telegram-oidc",
        callbackURL: "/settings",
      });
      expect(start.status).toBe(200);
      const callbackURL = issuer.authorize(start.json.url, telegramClaims());
      if (revoked) {
        await revoke();
      }

      const callback = await client.get(callbackURL);

      expect(callback.headers.get("location")).toContain(location);
      expect(db.account).toHaveLength(before.length + linkedAccounts);
      expect(
        db.account.filter((account) => account.providerId !== "telegram-oidc")
      ).toEqual(before);
      expect(
        db.account
          .filter((account) => account.providerId === "telegram-oidc")
          .map(({ accountId, userId }) => ({ accountId, userId }))
      ).toEqual(
        revoked
          ? []
          : [
              {
                accountId: "12224742808376279442",
                userId: db.user[0]!.id,
              },
            ]
      );
      expect(db.session).toHaveLength(revoked ? 0 : 1);
    }
  );
});
