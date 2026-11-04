/**
 * The fake issuer mirrors behavior measured on 2026-10-29: Basic auth,
 * PKCE, echoed nonce, 30-second tokens and errors returned as HTTP 200.
 */
import { createHash } from "node:crypto";
import {
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  type KeyObject,
  SignJWT,
} from "jose";
import { vi } from "vitest";
import {
  BOT_ID,
  TELEGRAM_AUTHORIZATION_ENDPOINT,
  TELEGRAM_ISSUER,
  TELEGRAM_JWKS_URI,
  TELEGRAM_TOKEN_ENDPOINT,
} from "./constants";

interface PendingAuthorization {
  claims: JWTPayload;
  codeChallenge: string | null;
  forge: boolean;
  nonce: string | null;
  omitIdToken: boolean;
  redirectURI: string;
}

export interface AuthorizeOptions {
  /** Sign the ID token with a key that is not in the JWKS. */
  forge?: boolean;
  /** Replace the nonce Telegram would echo (null drops it). */
  nonce?: string | null;
  /** Answer the token request without an `id_token`. */
  omitIdToken?: boolean;
}

/**
 * Fake oauth.telegram.org. Intercepts `fetch` for the token and JWKS
 * endpoints. Unexpected requests fail instead of reaching a real network.
 */
export async function mockTelegramOIDC(
  options: {
    clientId?: string;
    clientSecret?: string;
    alg?: "RS256" | "ES256" | "EdDSA";
  } = {}
) {
  const clientId = options.clientId ?? BOT_ID;
  const clientSecret = options.clientSecret ?? "oidc-client-secret";
  const alg = options.alg ?? "RS256";
  const newSigningKey = async (kid: string) => {
    const pair = await generateKeyPair(alg, {
      ...(alg === "EdDSA" ? { crv: "Ed25519" } : {}),
    });
    const jwk = { ...(await exportJWK(pair.publicKey)), kid, alg, use: "sig" };
    return { kid, privateKey: pair.privateKey, jwk };
  };
  let signingKey = await newSigningKey(`test-${alg.toLowerCase()}`);
  let jwksStatus = 200;
  const pending = new Map<string, PendingAuthorization>();
  const tokenRequests: {
    authorization: string | null;
    body: URLSearchParams;
  }[] = [];
  let jwksRequests = 0;
  let codeCounter = 0;

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const { url } = new Request(input as RequestInfo);
      if (url === TELEGRAM_JWKS_URI) {
        jwksRequests += 1;
        return jwksStatus === 200
          ? Response.json({ keys: [signingKey.jwk] })
          : new Response("Service Unavailable", { status: jwksStatus });
      }
      if (url === TELEGRAM_TOKEN_ENDPOINT) {
        const request = new Request(input as RequestInfo, init);
        const body = new URLSearchParams(await request.text());
        const authorization = request.headers.get("authorization");
        tokenRequests.push({ authorization, body });
        return Response.json(await tokenResponse(authorization, body));
      }
      throw new Error(`Unexpected network request in Telegram fixture: ${url}`);
    });

  /** Signs an ID token; `iss` / `aud` in `claims` override Telegram's. */
  async function sign(
    claims: JWTPayload,
    key: KeyObject | CryptoKey = signingKey.privateKey
  ) {
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT({ ...claims })
      .setProtectedHeader({ alg, kid: signingKey.kid, typ: "JWT" })
      .setIssuer(claims.iss ?? TELEGRAM_ISSUER)
      .setAudience(claims.aud ?? clientId)
      .setIssuedAt(claims.iat ?? now)
      .setExpirationTime(claims.exp ?? now + 30)
      .sign(key);
  }

  async function tokenResponse(
    authorization: string | null,
    body: URLSearchParams
  ) {
    const code = body.get("code") ?? "";
    const authz = pending.get(code);
    // Telegram validates the code before client credentials and answers
    // errors with HTTP 200.
    if (!authz || body.get("redirect_uri") !== authz.redirectURI) {
      return { error: "invalid_grant" };
    }
    const expected = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    const postAuth =
      body.get("client_id") === clientId &&
      body.get("client_secret") === clientSecret;
    if (authorization !== expected && !postAuth) {
      return { error: "invalid_client" };
    }
    if (authz.codeChallenge) {
      const verifier = body.get("code_verifier") ?? "";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (challenge !== authz.codeChallenge) {
        return { error: "invalid_grant" };
      }
    }
    pending.delete(code);
    const idToken = await sign(
      { ...authz.claims, ...(authz.nonce ? { nonce: authz.nonce } : {}) },
      authz.forge
        ? (await generateKeyPair(alg)).privateKey
        : signingKey.privateKey
    );
    return {
      access_token: "AAAAAAAAAAAAAAAAAAAAAAAA",
      ...(authz.omitIdToken ? {} : { id_token: idToken }),
      token_type: "Bearer",
      expires_in: 30,
      scope: "openid profile",
    };
  }

  /**
   * Simulates the user approving the login in Telegram: returns the callback
   * URL Telegram would redirect the browser to. Throws where Telegram would
   * refuse to show the login page.
   */
  function authorize(
    authorizationURL: string,
    claims: JWTPayload,
    authorizeOptions: AuthorizeOptions = {}
  ) {
    const url = new URL(authorizationURL);
    const scopes = (url.searchParams.get("scope") ?? "").split(" ");
    if (
      `${url.origin}${url.pathname}` !== TELEGRAM_AUTHORIZATION_ENDPOINT ||
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("client_id") !== clientId ||
      !scopes.includes("openid") ||
      !url.searchParams.get("redirect_uri") ||
      !url.searchParams.get("state")
    ) {
      throw new Error(
        `Telegram would reject this authorization request: ${url}`
      );
    }
    codeCounter += 1;
    const code = `code-${codeCounter}`;
    const redirectURI = url.searchParams.get("redirect_uri")!;
    pending.set(code, {
      claims,
      codeChallenge: url.searchParams.get("code_challenge"),
      forge: authorizeOptions.forge ?? false,
      nonce:
        authorizeOptions.nonce === undefined
          ? url.searchParams.get("nonce")
          : authorizeOptions.nonce,
      omitIdToken: authorizeOptions.omitIdToken ?? false,
      redirectURI,
    });
    const callback = new URL(redirectURI);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", url.searchParams.get("state")!);
    return callback.href;
  }

  return {
    clientId,
    clientSecret,
    authorize,
    sign,
    tokenRequests,
    get jwksRequests() {
      return jwksRequests;
    },
    /** Telegram replaces its signing key: new kid, old key gone from the JWKS. */
    rotateKey: async () => {
      signingKey = await newSigningKey(`test-${alg.toLowerCase()}-rotated`);
    },
    /** The HTTP status the JWKS endpoint answers with (200 = up). */
    setJwksStatus: (status: number) => {
      jwksStatus = status;
    },
    restore: () => fetchSpy.mockRestore(),
  };
}

export type TelegramOIDCMock = Awaited<ReturnType<typeof mockTelegramOIDC>>;
