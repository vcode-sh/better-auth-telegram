import type { JWTPayload } from "jose";
import type { TestClient } from "./http-client";
import type { AuthorizeOptions, TelegramOIDCMock } from "./oidc-server";

/** Default verified Telegram profile claims (values shaped like live data). */
export function telegramClaims(overrides: JWTPayload = {}): JWTPayload {
  return {
    sub: "12224742808376279442",
    id: "8306595751",
    name: "Ann Example",
    given_name: "Ann",
    family_name: "Example",
    preferred_username: "ann",
    picture: "https://t.me/i/userpic/320/ann.jpg",
    ...overrides,
  };
}

/** Runs `POST /sign-in/social` and approves the login at the fake Telegram. */
export async function signInWithTelegramOIDC(
  client: TestClient,
  telegramMock: TelegramOIDCMock,
  claims: JWTPayload = telegramClaims(),
  body: Record<string, unknown> = {},
  authorizeOptions: AuthorizeOptions = {}
) {
  const start = await client.post("/sign-in/social", {
    provider: "telegram-oidc",
    callbackURL: "/dashboard",
    ...body,
  });
  if (start.status !== 200 || !start.json?.url) {
    throw new Error(`sign-in/social failed: ${start.status} ${start.text}`);
  }
  const callbackURL = telegramMock.authorize(
    start.json.url,
    claims,
    authorizeOptions
  );
  const callback = await client.get(callbackURL);
  return { start, callback, location: callback.headers.get("location") };
}
