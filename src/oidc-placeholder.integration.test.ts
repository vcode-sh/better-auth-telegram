// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryAuth,
  mockTelegramOIDC,
  signInWithTelegramOIDC,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";

let issuer: TelegramOIDCMock;
beforeEach(async () => {
  issuer = await mockTelegramOIDC();
});
afterEach(() => issuer.restore());

const options = () => ({
  loginWidget: false,
  oidc: { enabled: true, clientSecret: issuer.clientSecret },
});

describe("opaque OIDC subjects do not depend on email syntax", () => {
  // OIDC Core permits opaque ASCII subject identifiers, up to 255 characters.
  it.each([
    ["opaque punctuation", "urn:telegram:user:42"],
    ["255-character subject", "x".repeat(255)],
  ])(
    "preserves subject %s and the same user on repeated sign-in",
    async (_case, sub) => {
      const { client, db } = createMemoryAuth(options());
      const claims = telegramClaims({ sub });

      const first = await signInWithTelegramOIDC(client, issuer, claims);
      expect(first.location).toBe("/dashboard");
      const userId = db.user[0]!.id;
      const { email } = db.user[0]!;
      const [local, domain] = email.split("@");
      expect(domain).toBe("telegram-oidc.placeholder.invalid");
      expect(local.length).toBeLessThanOrEqual(64);
      client.clearCookies();

      const second = await signInWithTelegramOIDC(client, issuer, claims);
      const session = await client.get("/get-session");

      expect(second.location).toBe("/dashboard");
      expect(session.json.user.id).toBe(userId);
      expect(session.json.user.email).toBe(email);
      expect(db.user).toHaveLength(1);
      expect(db.account).toHaveLength(1);
      expect(db.account[0]).toMatchObject({
        userId,
        accountId: sub,
        providerId: "telegram-oidc",
      });
    }
  );

  it.each([
    ["opaque punctuation", "urn:telegram:user:42"],
    ["64-character local part", "x".repeat(64)],
  ])(
    "does not reconnect the unlinked owner by the placeholder for %s",
    async (_case, sub) => {
      const { client, db } = createMemoryAuth(options(), {
        account: {
          accountLinking: {
            allowUnlinkingAll: true,
            trustedProviders: ["telegram-oidc"],
            requireLocalEmailVerified: false,
          },
        },
      });
      const claims = telegramClaims({ sub });
      const first = await signInWithTelegramOIDC(client, issuer, claims);
      expect(first.location).toBe("/dashboard");
      const oldUserId = db.user[0]!.id;
      const oldEmail = db.user[0]!.email;
      const unlink = await client.post("/unlink-account", {
        accountId: db.account[0]!.id,
      });
      expect(unlink.status).toBe(200);
      client.clearCookies();

      const again = await signInWithTelegramOIDC(client, issuer, claims);
      const session = await client.get("/get-session");

      expect(again.location).toBe("/dashboard");
      expect(session.json.user.id).not.toBe(oldUserId);
      expect(session.json.user.email).not.toBe(oldEmail);
      const [local, domain] = session.json.user.email.split("@");
      expect(domain).toBe("telegram-oidc.placeholder.invalid");
      expect(local.length).toBeLessThanOrEqual(64);
      expect(db.user).toHaveLength(2);
      expect(db.account).toHaveLength(1);
      expect(db.account[0]).toMatchObject({
        userId: session.json.user.id,
        accountId: sub,
      });
    }
  );
});
