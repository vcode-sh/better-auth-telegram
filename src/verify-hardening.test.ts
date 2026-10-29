// @vitest-environment node
/**
 * Freshness, hash format and check-string injection. The clock is fixed so
 * the boundaries are exact; the HMAC algorithm itself is pinned by literal
 * vectors in verify.test.ts, so signing with the harness is fine here.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  it as test,
  vi,
} from "vitest";
import { BOT_TOKEN, signInitParams, signWidgetData } from "./testing/harness";
import { verifyMiniAppInitData, verifyTelegramAuth } from "./verify";

const NOW = 1_761_730_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

const verifyWidgetAt = async (authDate: number, maxAge?: number) =>
  verifyTelegramAuth(
    (await signWidgetData({ id: 1, auth_date: authDate })) as any,
    BOT_TOKEN,
    maxAge
  );

const verifyMiniAppAt = async (authDate: number, maxAge?: number) =>
  verifyMiniAppInitData(
    await signInitParams({ auth_date: String(authDate) }),
    BOT_TOKEN,
    maxAge
  );

describe.each([
  ["Login Widget", verifyWidgetAt],
  ["Mini App", verifyMiniAppAt],
])("%s auth_date freshness", (_flow, verifyAt) => {
  // Rule: no older than maxAge seconds, no more than 60 s in the future.
  test.each([
    ["exactly maxAge old", true, NOW - 3600],
    ["one second older than maxAge", false, NOW - 3601],
    ["60 s in the future (clock skew)", true, NOW + 60],
    ["61 s in the future", false, NOW + 61],
  ])(
    "with maxAge 3600, data %s → valid: %s",
    async (_case, expected, authDate) => {
      expect(await verifyAt(authDate, 3600)).toBe(expected);
    }
  );

  test("defaults maxAge to 24 hours", async () => {
    expect(await verifyAt(NOW - 86_400)).toBe(true);
    expect(await verifyAt(NOW - 86_401)).toBe(false);
  });
});

describe("Mini App auth_date", () => {
  it("rejects a signed, non-numeric auth_date (NaN slips past age comparisons)", async () => {
    const initData = await signInitParams({ auth_date: "soon" });

    expect(await verifyMiniAppInitData(initData, BOT_TOKEN)).toBe(false);
  });
});

describe("hash format", () => {
  it("rejects a genuine hash with trailing characters or in uppercase", async () => {
    // The decoder reads 64 hex characters; both variants decode to the same
    // bytes, so only the format check can reject them.
    const data = await signWidgetData({ id: 1 });

    expect(await verifyTelegramAuth(data as any, BOT_TOKEN)).toBe(true);
    expect(
      await verifyTelegramAuth(
        { ...data, hash: `${data.hash}00` } as any,
        BOT_TOKEN
      )
    ).toBe(false);
    expect(
      await verifyTelegramAuth(
        { ...data, hash: data.hash.toUpperCase() } as any,
        BOT_TOKEN
      )
    ).toBe(false);
  });
});

describe("data-check-string injection", () => {
  it("rejects Login Widget fields containing a newline", async () => {
    // If Telegram ever signed `first_name: "a\nid=666\nidz=Q"` for user 1,
    // splitting it into separate fields would forge user 666.
    const signed = await signWidgetData({
      id: 1,
      first_name: "a\nid=666\nidz=Q",
    });
    const forged = {
      first_name: "a",
      id: 666,
      idz: "Q\nid=1",
      auth_date: (signed as { auth_date?: number }).auth_date,
      hash: signed.hash,
    };

    expect(await verifyTelegramAuth(signed as any, BOT_TOKEN)).toBe(false);
    expect(await verifyTelegramAuth(forged as any, BOT_TOKEN)).toBe(false);
  });
});
