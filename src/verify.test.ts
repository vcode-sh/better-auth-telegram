// @vitest-environment node
/**
 * HMAC verification against literal vectors computed independently with
 * openssl (not with this code or the test harness), so a misreading of
 * Telegram's algorithm shared by the code and the harness cannot pass:
 *
 *   widget key:   printf '%s' "$TOKEN" | openssl dgst -sha256 -binary
 *   Mini App key: printf '%s' "$TOKEN" | openssl dgst -sha256 -mac HMAC -macopt key:WebAppData
 *   hash:         printf '<data-check-string>' | openssl dgst -sha256 -mac HMAC -macopt hexkey:<key>
 *
 * Freshness boundaries live in verify-hardening.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInitParams } from "./testing/harness";
import {
  parseMiniAppInitData,
  verifyMiniAppInitData,
  verifyTelegramAuth,
} from "./verify";

const BOT_TOKEN = "123456789:AAtesttokentesttokentesttokentest";
/** Same bot id, different secret: the key must come from the whole token. */
const SAME_BOT_OTHER_SECRET = "123456789:AAothersecret";
const AUTH_DATE = 1_761_730_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((AUTH_DATE + 10) * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Login Widget hash (literal vectors)", () => {
  // Fields deliberately not in alphabetical order; non-ASCII and quote in names.
  const full = {
    id: 42,
    first_name: "José",
    last_name: "O'Brien",
    username: "ann",
    photo_url: "https://t.me/i/userpic/320/ann.jpg",
    auth_date: AUTH_DATE,
    hash: "0c18e034651cb6f65700fe8abc945c991c5c6fce4e2335cd371f34bcff363d86",
  };

  it("accepts Telegram's hash over every received field, sorted, UTF-8 encoded", async () => {
    expect(await verifyTelegramAuth(full, BOT_TOKEN)).toBe(true);
  });

  it("accepts a payload without the optional fields (no `last_name=undefined` lines)", async () => {
    const minimal = {
      id: 42,
      first_name: "Ann",
      auth_date: AUTH_DATE,
      hash: "b50b91e717224887207df7d0a34eb144dd0020353b9ea2150477df0b4060ea07",
    };

    expect(await verifyTelegramAuth(minimal, BOT_TOKEN)).toBe(true);
  });

  it("rejects another user's id under a genuine hash", async () => {
    expect(await verifyTelegramAuth({ ...full, id: 43 }, BOT_TOKEN)).toBe(
      false
    );
  });

  it("rejects the hash for a token with the same bot id but another secret", async () => {
    expect(await verifyTelegramAuth(full, SAME_BOT_OTHER_SECRET)).toBe(false);
  });
});

describe("Mini App initData hash (literal vector)", () => {
  // As Telegram sends it: URL-encoded, fields unsorted, `\/` escaped in the
  // user JSON, and a `signature` field (Bot API 8.0+).
  const initData =
    "query_id=AAHdF6IQAAAAAN0XohDhrOrc" +
    "&user=%7B%22id%22%3A8306595751%2C%22first_name%22%3A%22Ann%22%2C%22last_name%22%3A%22Example%22%2C%22username%22%3A%22ann%22%2C%22language_code%22%3A%22en%22%2C%22allows_write_to_pm%22%3Atrue%2C%22photo_url%22%3A%22https%3A%5C%2F%5C%2Ft.me%5C%2Fi%5C%2Fuserpic%5C%2F320%5C%2Fann.svg%22%7D" +
    "&chat_instance=-3788475317572404878&chat_type=private&auth_date=1761730000" +
    "&signature=kXz3oVbV0wL3n0rZt7x1Qq9oX2y4m6n8p0r2t4v6x8z0B2D4F6H8J0L2N4P6R8T0V2X4Z6b8d0f2h4j6l8n0pA";
  const withHash = (hash: string) => `${initData}&hash=${hash}`;

  it("accepts Telegram's hash over the raw decoded values, signature included", async () => {
    // Fails if signature is dropped from the check string, if the user JSON is
    // re-serialized (losing `\/`), or if the fields are not sorted.
    const valid = withHash(
      "2155f29ff29aece78a404c46979b49ea4d763e042e39517bff325feb7a825d77"
    );

    expect(await verifyMiniAppInitData(valid, BOT_TOKEN)).toBe(true);
  });

  it("rejects a hash computed without the signature field", async () => {
    const withoutSignature = withHash(
      "23c76e8fb305ca28de16f398a81666ae45c75f4f5ce62474ecf416e8229036c6"
    );

    expect(await verifyMiniAppInitData(withoutSignature, BOT_TOKEN)).toBe(
      false
    );
  });

  it("rejects a hash keyed like the Login Widget (SHA256(token) instead of WebAppData)", async () => {
    const widgetKeyed = withHash(
      "fecf6e42e401cdf4316fff882118c0032e8ee1cdab6798289c70f9ceddd497cf"
    );

    expect(await verifyMiniAppInitData(widgetKeyed, BOT_TOKEN)).toBe(false);
  });

  it("rejects the hash for a token with the same bot id but another secret", async () => {
    const valid = withHash(
      "2155f29ff29aece78a404c46979b49ea4d763e042e39517bff325feb7a825d77"
    );

    expect(await verifyMiniAppInitData(valid, SAME_BOT_OTHER_SECRET)).toBe(
      false
    );
  });

  it("rejects signed initData that carries no auth_date", async () => {
    const undated = await signInitParams({
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
      user: '{"id":7,"first_name":"Ann"}',
    });

    expect(await verifyMiniAppInitData(undated, BOT_TOKEN)).toBe(false);
  });
});

describe("parseMiniAppInitData", () => {
  it("drops a malformed user JSON instead of throwing (the endpoint answers 400, not 500)", () => {
    const parsed = parseMiniAppInitData(
      "user={invalid json}&auth_date=1761730000&hash=abc123"
    );

    expect(parsed.user).toBeUndefined();
    expect(parsed.auth_date).toBe(1_761_730_000);
  });
});
