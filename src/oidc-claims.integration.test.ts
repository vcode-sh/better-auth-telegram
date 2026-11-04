// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createMemoryAuth,
  mockTelegramOIDC,
  signInWithTelegramOIDC,
  type TelegramOIDCMock,
  telegramClaims,
} from "./testing/harness";
import type { TelegramOIDCClaims } from "./types";

let telegram: TelegramOIDCMock;

beforeEach(async () => {
  telegram = await mockTelegramOIDC();
});

afterEach(() => {
  telegram.restore();
});

test("gives mappers the same string identity for numeric and string ID tokens", async () => {
  const mapper = vi.fn((claims: TelegramOIDCClaims) => ({
    name: `Telegram ${claims.id?.trim()}`,
  }));
  const { client, db } = createMemoryAuth({
    oidc: {
      enabled: true,
      clientSecret: telegram.clientSecret,
      mapOIDCProfileToUser: mapper,
    },
  });

  async function signInAndCheckSession(id: string | number) {
    client.clearCookies();
    const { location } = await signInWithTelegramOIDC(
      client,
      telegram,
      telegramClaims({ id })
    );
    const session = await client.get("/get-session");

    expect(location).toBe("/dashboard");
    expect(session.json.user).toMatchObject({
      name: "Telegram 8306595751",
      telegramId: "8306595751",
    });
  }

  await signInAndCheckSession(8_306_595_751);
  await signInAndCheckSession("8306595751");

  expect(mapper.mock.calls.map(([claims]) => claims.id)).toEqual([
    "8306595751",
    "8306595751",
  ]);
  expect(db.user).toHaveLength(1);
  expect(db.account).toHaveLength(1);
  expect(db.account[0]).toMatchObject({
    providerId: "telegram-oidc",
    accountId: "12224742808376279442",
  });
});
