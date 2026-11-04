// @vitest-environment node
import { describe, expect, it, it as test } from "vitest";
import {
  createMemoryAuth,
  signInitData,
  signInitParams,
  signWidgetData,
} from "./testing/harness";

describe("Mini App signature and parsed data agree", () => {
  it("rejects a conflicting hash appended to genuine signed initData", async () => {
    const { client, db } = createMemoryAuth({ miniApp: { enabled: true } });
    const signed = await signInitData({ id: 42 });
    const genuine = await client.post("/telegram/miniapp/validate", {
      initData: signed,
    });
    expect(genuine.json.valid).toBe(true);
    expect(genuine.json.data.user.id).toBe(42);

    // An untrusted caller can append this without knowing the bot token.
    const ambiguous = `${signed}&hash=${"0".repeat(64)}`;
    const validation = await client.post("/telegram/miniapp/validate", {
      initData: ambiguous,
    });
    const signIn = await client.post("/telegram/miniapp/signin", {
      initData: ambiguous,
    });

    expect(validation.json).toEqual({ valid: false, data: null });
    expect(signIn.status).toBe(401);
    expect(signIn.json.code).toBe("INVALID_MINI_APP_INIT_DATA");
    expect([db.user.length, db.account.length, db.session.length]).toEqual([
      0, 0, 0,
    ]);
  });
});

// Telegram defines user IDs as integers with at most 52 significant bits.
// Raw HTTP/provider JSON still needs validation despite our TypeScript types.
describe.each(["Login Widget", "Mini App"] as const)(
  "%s Telegram identity input",
  (method) => {
    test.each(["0", "-1", "1.5", "9007199254740993"])(
      "rejects id=%s instead of provisioning a noncanonical or rounded identity",
      async (id) => {
        const { client, db } = createMemoryAuth({ miniApp: { enabled: true } });
        const response =
          method === "Login Widget"
            ? await client.post(
                "/telegram/signin",
                await signWidgetData({ id: Number(id) })
              )
            : await client.post("/telegram/miniapp/signin", {
                initData: await signInitParams({
                  auth_date: String(Math.floor(Date.now() / 1000)),
                  user: `{"id":${id},"first_name":"Ann"}`,
                }),
              });

        expect(response.status).toBe(400);
        expect(response.json.code).toBe(
          method === "Login Widget"
            ? "INVALID_AUTH_DATA"
            : "INVALID_MINI_APP_DATA_STRUCTURE"
        );
        expect([db.user.length, db.account.length, db.session.length]).toEqual([
          0, 0, 0,
        ]);
      }
    );

    test("preserves a valid 52-bit identity without truncation", async () => {
      const { client, db } = createMemoryAuth({ miniApp: { enabled: true } });
      const id = 4_503_599_627_370_495;
      const response =
        method === "Login Widget"
          ? await client.post("/telegram/signin", await signWidgetData({ id }))
          : await client.post("/telegram/miniapp/signin", {
              initData: await signInitData({ id }),
            });

      expect(response.status).toBe(200);
      expect(response.json.user.telegramId).toBe("4503599627370495");
      expect(db.account[0]).toMatchObject({
        accountId: "4503599627370495",
        userId: response.json.user.id,
      });
      expect(response.json.session.userId).toBe(response.json.user.id);
    });
  }
);
