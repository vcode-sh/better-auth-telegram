import type { OAuthProvider } from "@better-auth/core/oauth2";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
} from "@better-auth/core/oauth2";
import { betterFetch } from "@better-fetch/fetch";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import {
  TELEGRAM_OIDC_AUTH_ENDPOINT,
  TELEGRAM_OIDC_ISSUER,
  TELEGRAM_OIDC_JWKS_URI,
  TELEGRAM_OIDC_PROVIDER_ID,
  TELEGRAM_OIDC_TOKEN_ENDPOINT,
} from "./constants";
import type { TelegramOIDCClaims, TelegramOIDCOptions } from "./types";

/**
 * Fetches a public key from Telegram's JWKS endpoint by key ID
 */
const getTelegramPublicKey = async (kid: string) => {
  const { data } = await betterFetch<{
    keys: Array<{
      kid: string;
      kty: string;
      use: string;
      alg: string;
      n: string;
      e: string;
    }>;
  }>(TELEGRAM_OIDC_JWKS_URI);

  if (!data?.keys) {
    throw new Error("Failed to fetch Telegram JWKS");
  }

  const jwk = data.keys.find((key) => key.kid === kid);
  if (!jwk) {
    throw new Error(`JWK with kid ${kid} not found`);
  }

  return await importJWK(jwk, jwk.alg);
};

/**
 * Builds the scopes array from OIDC options
 */
function buildScopes(options: TelegramOIDCOptions): string[] {
  const scopes = new Set<string>(["openid"]);

  if (options.scopes) {
    for (const scope of options.scopes) {
      scopes.add(scope);
    }
  } else {
    scopes.add("profile");
  }

  if (options.requestPhone) {
    scopes.add("phone");
  }

  if (options.requestBotAccess) {
    scopes.add("telegram:bot_access");
  }

  return Array.from(scopes);
}

/**
 * Creates a Telegram OIDC provider for better-auth's social login system.
 *
 * Follows the same pattern as Google's provider in better-auth core.
 * Uses standard OAuth 2.0 Authorization Code flow with PKCE
 * via oauth.telegram.org.
 *
 * @param botToken - Bot token from @BotFather (used as client_id:client_secret)
 * @param options - OIDC configuration options
 */
export function createTelegramOIDCProvider(
  botToken: string,
  options: TelegramOIDCOptions = {}
): OAuthProvider<TelegramOIDCClaims> {
  const botId = botToken.split(":")[0]!;

  const providerOptions = {
    clientId: botId,
    clientSecret: botToken,
  };

  return {
    id: TELEGRAM_OIDC_PROVIDER_ID,
    name: "Telegram",

    createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      const _scopes = buildScopes(options);
      if (scopes) {
        _scopes.push(...scopes);
      }

      // Telegram OIDC requires the "origin" parameter matching the redirect_uri origin.
      // Telegram also expects "bot_id" — the standard "client_id" is sent by
      // Better Auth's createAuthorizationURL, but Telegram may not recognise it.
      const origin = new URL(redirectURI).origin;

      return createAuthorizationURL({
        id: TELEGRAM_OIDC_PROVIDER_ID,
        options: providerOptions,
        authorizationEndpoint: TELEGRAM_OIDC_AUTH_ENDPOINT,
        scopes: _scopes,
        state,
        codeVerifier,
        redirectURI,
        additionalParams: { origin, bot_id: botId },
      });
    },

    validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      return validateAuthorizationCode({
        code,
        codeVerifier,
        redirectURI,
        options: providerOptions,
        tokenEndpoint: TELEGRAM_OIDC_TOKEN_ENDPOINT,
      });
    },

    async verifyIdToken(token) {
      try {
        const { kid, alg } = decodeProtectedHeader(token);
        if (!(kid && alg)) {
          return false;
        }

        const publicKey = await getTelegramPublicKey(kid);
        const { payload } = await jwtVerify(token, publicKey, {
          algorithms: [alg],
          issuer: TELEGRAM_OIDC_ISSUER,
          audience: botId,
        });

        return !!payload;
      } catch {
        return false;
      }
    },

    getUserInfo(token) {
      if (!token.idToken) {
        console.warn(
          "[better-auth-telegram] OIDC getUserInfo: no id_token in token response.",
          "Token keys:",
          Object.keys(token).filter((k) => k !== "raw"),
          "Raw keys:",
          token.raw ? Object.keys(token.raw) : "none"
        );
        return Promise.resolve(null);
      }

      let claims: TelegramOIDCClaims;
      try {
        claims = decodeJwt(token.idToken) as TelegramOIDCClaims;
      } catch (e) {
        console.warn(
          "[better-auth-telegram] OIDC getUserInfo: failed to decode id_token.",
          e instanceof Error ? e.message : e
        );
        return Promise.resolve(null);
      }

      if (!claims.sub) {
        console.warn(
          "[better-auth-telegram] OIDC getUserInfo: id_token has no sub claim.",
          "Claims:",
          Object.keys(claims)
        );
        return Promise.resolve(null);
      }

      const userMap = options.mapOIDCProfileToUser
        ? options.mapOIDCProfileToUser(claims)
        : undefined;

      // Telegram OIDC doesn't provide email — generate a placeholder
      // so Better Auth's callback flow doesn't reject with "email_not_found".
      // Users can override via mapOIDCProfileToUser if they have a real email.
      const placeholderEmail = `${claims.sub}@telegram.oidc`;

      return Promise.resolve({
        user: {
          id: claims.sub,
          name: claims.name,
          image: claims.picture,
          email: placeholderEmail,
          emailVerified: false,
          ...userMap,
        },
        data: claims,
      });
    },

    options: providerOptions,
  };
}

export { buildScopes };
