import { describe, expect, it } from "vitest";
import { signInitParams, signWidgetData } from "./testing/harness";
import { verifyMiniAppInitData, verifyTelegramAuth } from "./verify";

const BOT_TOKEN = "123456789:AAtesttokentesttokentesttokentest";
const now = () => Math.floor(Date.now() / 1000);

describe("auth_date freshness", () => {
  it("rejects Login Widget data dated more than a minute in the future", async () => {
    const data = await signWidgetData({ id: 1, auth_date: now() + 120 });

    expect(await verifyTelegramAuth(data as any, BOT_TOKEN)).toBe(false);
  });

  it("tolerates small clock skew", async () => {
    const data = await signWidgetData({ id: 1, auth_date: now() + 30 });

    expect(await verifyTelegramAuth(data as any, BOT_TOKEN)).toBe(true);
  });

  it("rejects Mini App data dated in the future", async () => {
    const initData = await signInitParams({ auth_date: String(now() + 120) });

    expect(await verifyMiniAppInitData(initData, BOT_TOKEN)).toBe(false);
  });

  it("rejects a non-numeric Mini App auth_date even when signed", async () => {
    const initData = await signInitParams({ auth_date: "soon" });

    expect(await verifyMiniAppInitData(initData, BOT_TOKEN)).toBe(false);
  });
});

describe("hash format", () => {
  it("rejects a hash that is not 64 lowercase hex characters", async () => {
    const data = await signWidgetData({ id: 1 });

    const results = await Promise.all(
      [`${data.hash}00`, data.hash.slice(2), "zz".repeat(32)].map((hash) =>
        verifyTelegramAuth({ ...data, hash } as any, BOT_TOKEN)
      )
    );

    expect(results).toEqual([false, false, false]);
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
