// @vitest-environment node
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  it as test,
  vi,
} from "vitest";
import {
  createMemoryAuth,
  mockTelegramOIDC,
  signInitData,
  signInWithTelegramOIDC,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";

let issuer: TelegramOIDCMock;
beforeEach(async () => {
  issuer = await mockTelegramOIDC();
});
afterEach(() => {
  issuer.restore();
});

describe("OIDC subject validation before application effects", () => {
  // OIDC Core defines sub as a required string. It must be usable as an
  // account key before a mapper or cross-flow identity lookup sees it.
  it.each([
    ["callback", "", 302, "unable_to_get_user_info"],
    ["callback", 123, 302, "unable_to_get_user_info"],
    ["direct token", "", 401, "INVALID_TOKEN"],
    ["direct token", 123, 401, "INVALID_TOKEN"],
  ] as const)(
    "rejects %s with invalid subject %j before mapping or linking",
    async (flow, sub, status, errorCode) => {
      const mapper = vi.fn(() => ({ name: "Mapped profile" }));
      const { client, db } = createMemoryAuth({
        loginWidget: false,
        miniApp: { enabled: true },
        oidc: {
          enabled: true,
          clientSecret: issuer.clientSecret,
          mapOIDCProfileToUser: mapper,
        },
      });
      const first = await client.post("/telegram/miniapp/signin", {
        initData: await signInitData({ id: 7 }),
      });
      expect(first.status).toBe(200);
      client.clearCookies();
      const before = structuredClone({
        users: db.user,
        accounts: db.account,
        sessions: db.session,
      });
      const claims = telegramClaims({ id: "7", sub: sub as string });

      const response =
        flow === "callback"
          ? (await signInWithTelegramOIDC(client, issuer, claims)).callback
          : await client.post("/sign-in/social", {
              provider: "telegram-oidc",
              idToken: {
                token: await issuer.sign({ ...claims, nonce: "n" }),
                nonce: "n",
              },
            });
      const error =
        response.json?.code ??
        new URL(
          response.headers.get("location") ?? "http://localhost"
        ).searchParams.get("error");

      expect(response.status).toBe(status);
      expect(error).toBe(errorCode);
      expect(mapper).not.toHaveBeenCalled();
      expect(client.hasSession()).toBe(false);
      expect({
        users: db.user,
        accounts: db.account,
        sessions: db.session,
      }).toEqual(before);
    }
  );
});

test("normalizes the accepted audience array before a typed mapper consumes it", async () => {
  const { client, db } = createMemoryAuth({
    loginWidget: false,
    oidc: {
      enabled: true,
      clientSecret: issuer.clientSecret,
      mapOIDCProfileToUser: (claims) => ({
        name: `Client ${claims.aud.trim()}`,
      }),
    },
  });

  const { location } = await signInWithTelegramOIDC(
    client,
    issuer,
    telegramClaims({ aud: ["123456789"] })
  );
  const session = await client.get("/get-session");

  expect(location).toBe("/dashboard");
  expect(session.json.user.name).toBe("Client 123456789");
  expect(session.json.user.id).toBe(db.user[0]!.id);
  expect(db.account[0]!.accountId).toBe("12224742808376279442");
});
