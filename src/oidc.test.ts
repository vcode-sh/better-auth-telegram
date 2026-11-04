// @vitest-environment node
/**
 * Provider rules that are awkward to reach through a full sign-in. The
 * authorization URL, token exchange, ID token checks and account binding are
 * covered against a real Better Auth instance in oidc.integration.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramOIDCProvider } from "./oidc";
import {
  BOT_TOKEN,
  mockTelegramOIDC,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";
import type { TelegramOIDCClaims } from "./types";

const CLIENT_SECRET = "client-secret-from-botfather";
describe("accountSubject", () => {
  const profile = telegramClaims() as unknown as TelegramOIDCClaims;

  it.each([
    ["empty", ""],
    ["numeric", 123],
  ])("refuses to key an account by an %s sub", (_kind, sub) => {
    const provider = createTelegramOIDCProvider(BOT_TOKEN, {
      clientSecret: CLIENT_SECRET,
    });

    expect(() =>
      provider.accountSubject({
        tokens: {},
        profile: { ...profile, sub } as unknown as TelegramOIDCClaims,
      })
    ).toThrow("ID token has no subject");
  });
});

describe("getUserInfo", () => {
  let telegram: TelegramOIDCMock;

  beforeEach(async () => {
    telegram = await mockTelegramOIDC();
  });

  afterEach(() => {
    telegram.restore();
    vi.restoreAllMocks();
  });

  const provider = (options = {}) =>
    createTelegramOIDCProvider(BOT_TOKEN, {
      clientSecret: CLIENT_SECRET,
      ...options,
    });

  it("names the user from given and family name, then username, when `name` is absent", async () => {
    const fromParts = await provider().getUserInfo({
      idToken: await telegram.sign(telegramClaims({ name: undefined })),
    });
    const fromUsername = await provider().getUserInfo({
      idToken: await telegram.sign({ sub: "1", preferred_username: "ann" }),
    });

    expect(fromParts?.user.name).toBe("Ann Example");
    expect(fromUsername?.user.name).toBe("ann");
  });

  it("applies mapOIDCProfileToUser but never lets it set the user id", async () => {
    const result = await provider({
      mapOIDCProfileToUser: (claims: TelegramOIDCClaims) => ({
        id: "hijack",
        email: `${claims.preferred_username}@example.com`,
      }),
    }).getUserInfo({ idToken: await telegram.sign(telegramClaims()) });

    expect(result?.user.email).toBe("ann@example.com");
    expect(result?.user).not.toHaveProperty("id");
  });

  it.each([
    null,
    true,
    {},
    [],
    -1,
    0,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "",
    " 7",
    "7 ",
    "01",
    "1.5",
    "1e3",
  ])(
    "rejects an invalid profile id %j before invoking the mapper",
    async (id) => {
      const mapper = vi.fn();
      const logger = { warn: vi.fn() };
      const oidcProvider = createTelegramOIDCProvider(
        BOT_TOKEN,
        { clientSecret: CLIENT_SECRET, mapOIDCProfileToUser: mapper },
        logger
      );

      const result = await oidcProvider.getUserInfo({
        idToken: await telegram.sign(telegramClaims({ id })),
      });

      expect(result).toBeNull();
      expect(mapper).not.toHaveBeenCalled();
    }
  );
});
