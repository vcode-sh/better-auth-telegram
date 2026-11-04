import { createHash } from "node:crypto";
import { BOT_TOKEN, MINI_APP_SIGNATURE } from "./constants";

async function hmacHex(key: Uint8Array, data: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data)
  );
  return Buffer.from(signature).toString("hex");
}

/** Login Widget payload signed exactly like Telegram signs it. */
export async function signWidgetData(
  fields: Record<string, string | number> & { id: number },
  botToken = BOT_TOKEN
) {
  const data: Record<string, string | number> = {
    first_name: "Ann",
    auth_date: Math.floor(Date.now() / 1000),
    ...fields,
  };
  const checkString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  return { ...data, hash: await hmacHex(secret, checkString) };
}

/** Code-unit key order, as Telegram sorts the data-check-string. */
function byCodeUnit([a]: [string, string], [b]: [string, string]) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** Signs arbitrary initData fields exactly like Telegram signs them. */
export async function signInitParams(
  fields: Record<string, string>,
  botToken = BOT_TOKEN
) {
  const params = new URLSearchParams(fields);
  const checkString = [...params.entries()]
    .sort(byCodeUnit)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = new Uint8Array(
    Buffer.from(
      await hmacHex(new TextEncoder().encode("WebAppData"), botToken),
      "hex"
    )
  );
  params.set("hash", await hmacHex(secret, checkString));
  return params.toString();
}

/**
 * Mini App initData for `user`, shaped and signed like Telegram's: the user
 * JSON escapes `/` as `\/`, and `signature` is part of the signed fields.
 */
export function signInitData(
  user: Record<string, unknown> & { id: number },
  extra: Record<string, string> = {},
  botToken = BOT_TOKEN
) {
  return signInitParams(
    {
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
      user: JSON.stringify({ first_name: "Ann", ...user }).replaceAll(
        "/",
        "\\/"
      ),
      auth_date: String(Math.floor(Date.now() / 1000)),
      signature: MINI_APP_SIGNATURE,
      ...extra,
    },
    botToken
  );
}
