import { createRemoteJWKSet, jwtVerify } from "jose";
import { TELEGRAM_OIDC_ISSUER, TELEGRAM_OIDC_JWKS_URI } from "./constants";
import type { TelegramOIDCClaims } from "./types";

/**
 * Algorithms Telegram can sign ID tokens with that Web Crypto can verify.
 * ES256K (secp256k1) is offered by @BotFather but has no Web Crypto support.
 */
const SUPPORTED_SIGNING_ALGORITHMS = ["RS256", "ES256", "EdDSA"];

/** Matches Better Auth's own ID token verifier. */
const ID_TOKEN_CLOCK_TOLERANCE_SECONDS = 30;
const ID_TOKEN_REQUIRED_CLAIMS = ["iss", "sub", "aud", "exp", "iat"];

/** Telegram documents a number but also sends strings; mappers always get strings. */
function normalizeTelegramId(id: unknown): string {
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
    return String(id);
  }
  if (typeof id === "string" && /^[1-9][0-9]*$/u.test(id)) {
    return id;
  }
  throw new Error("ID token has an invalid Telegram user id");
}

/** One verifier per provider keeps both sign-in paths on the same JWKS cache and checks. */
export function createTelegramIdTokenVerifier(clientId: string) {
  // Fetched lazily, cached and rate limited by jose; shared by every request
  // served by this Better Auth instance.
  const jwks = createRemoteJWKSet(new URL(TELEGRAM_OIDC_JWKS_URI));

  return async (
    token: string,
    expectedNonce: string | undefined
  ): Promise<TelegramOIDCClaims> => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: TELEGRAM_OIDC_ISSUER,
      audience: clientId,
      algorithms: SUPPORTED_SIGNING_ALGORITHMS,
      requiredClaims: ID_TOKEN_REQUIRED_CLAIMS,
      clockTolerance: ID_TOKEN_CLOCK_TOLERANCE_SECONDS,
    });
    // JOSE checks presence, not the subject's type. Reject unusable identities
    // before mappers or cross-flow linking can perform application work.
    if (typeof payload.sub !== "string" || !payload.sub.trim()) {
      throw new Error("ID token has no subject");
    }
    // OIDC Core 3.1.3.7: reject a token that also names audiences we don't
    // trust (jose only checks that ours is among them).
    if ([payload.aud].flat().some((audience) => audience !== clientId)) {
      throw new Error("ID token is also issued to another audience");
    }
    // Only this client is trusted; expose the public string claim even when
    // the issuer encoded that same audience as a one-element array.
    payload.aud = clientId;
    if (expectedNonce !== undefined && payload.nonce !== expectedNonce) {
      throw new Error(
        "ID token nonce does not match the authorization request"
      );
    }
    if (payload.id !== undefined) {
      payload.id = normalizeTelegramId(payload.id);
    }
    return payload as unknown as TelegramOIDCClaims;
  };
}
