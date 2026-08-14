import type { OAuthProvider } from "@better-auth/core/oauth2";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
} from "@better-auth/core/oauth2";
import { betterFetch } from "@better-fetch/fetch";
import { decodeProtectedHeader, importJWK, type JWK, jwtVerify } from "jose";
import {
  DEFAULT_OIDC_JWKS_FETCH_TIMEOUT_MS,
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
const SUPPORTED_SIGNING_ALGORITHMS = new Set(["RS256", "ES256", "EdDSA"]);

const getTelegramPublicKey = async (
  kid: string,
  algorithm: string,
  timeout: number
) => {
  const { data } = await betterFetch<{
    keys: JWK[];
  }>(TELEGRAM_OIDC_JWKS_URI, { timeout });

  if (!data?.keys) {
    throw new Error("Failed to fetch Telegram JWKS");
  }

  const jwk = data.keys.find((key) => key.kid === kid && key.alg === algorithm);
  if (!jwk) {
    throw new Error(`JWK with kid ${kid} and algorithm ${algorithm} not found`);
  }

  return await importJWK(jwk, algorithm);
};

const verifyTelegramIdToken = async (
  token: string,
  clientId: string,
  jwksFetchTimeoutMs: number
): Promise<TelegramOIDCClaims> => {
  const { kid, alg } = decodeProtectedHeader(token);
  if (!(kid && alg)) {
    throw new Error("Telegram ID token is missing kid or alg");
  }
  if (!SUPPORTED_SIGNING_ALGORITHMS.has(alg)) {
    throw new Error(`Unsupported Telegram ID token algorithm: ${alg}`);
  }

  const publicKey = await getTelegramPublicKey(kid, alg, jwksFetchTimeoutMs);
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: [alg],
    issuer: TELEGRAM_OIDC_ISSUER,
    audience: clientId,
  });

  return payload as unknown as TelegramOIDCClaims;
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
 * @param botToken - Bot token from @BotFather (bot ID extracted as client_id)
 * @param options - OIDC configuration options
 */
export function createTelegramOIDCProvider(
  botToken: string,
  options: TelegramOIDCOptions = {}
): OAuthProvider<TelegramOIDCClaims> {
  const botId = botToken.split(":")[0]!;

  // Client ID and secret come from BotFather's Web Login settings (Bot Settings > Web Login).
  // Falls back to bot token values for backward compatibility.
  const clientId = options.clientId || botId;
  const clientSecret = options.clientSecret || botToken;
  const jwksFetchTimeoutMs =
    options.jwksFetchTimeoutMs ?? DEFAULT_OIDC_JWKS_FETCH_TIMEOUT_MS;
  if (!(Number.isFinite(jwksFetchTimeoutMs) && jwksFetchTimeoutMs > 0)) {
    throw new Error(
      "[better-auth-telegram] OIDC: jwksFetchTimeoutMs must be a positive finite number."
    );
  }
  if (!(options.clientSecret || botToken)) {
    console.warn(
      "[better-auth-telegram] OIDC: clientSecret is required before starting an OIDC login."
    );
  } else if (!options.clientSecret) {
    console.warn(
      "[better-auth-telegram] OIDC: no clientSecret provided. Using bot token as fallback.",
      "For OIDC to work, configure Web Login in @BotFather (Bot Settings > Web Login)",
      "and pass the Client Secret via oidc.clientSecret."
    );
  }

  const providerOptions = {
    clientId,
    clientSecret,
  };

  const requireOIDCCredentials = () => {
    if (!clientId) {
      throw new Error(
        "[better-auth-telegram] OIDC: clientId is required before starting an OIDC login."
      );
    }
    if (!clientSecret) {
      throw new Error(
        "[better-auth-telegram] OIDC: clientSecret is required before starting an OIDC login."
      );
    }
  };

  return {
    id: TELEGRAM_OIDC_PROVIDER_ID,
    name: "Telegram",

    createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
      requireOIDCCredentials();

      const _scopes = buildScopes(options);
      if (scopes) {
        _scopes.push(...scopes);
      }

      return createAuthorizationURL({
        id: TELEGRAM_OIDC_PROVIDER_ID,
        options: providerOptions,
        authorizationEndpoint: TELEGRAM_OIDC_AUTH_ENDPOINT,
        scopes: _scopes,
        state,
        codeVerifier,
        redirectURI,
      });
    },

    validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      requireOIDCCredentials();

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
        if (!clientId) {
          return false;
        }
        await verifyTelegramIdToken(token, clientId, jwksFetchTimeoutMs);
        return true;
      } catch {
        return false;
      }
    },

    async getUserInfo(token) {
      if (!token.idToken) {
        console.warn(
          "[better-auth-telegram] OIDC getUserInfo: no id_token in token response.",
          "Token keys:",
          Object.keys(token).filter((k) => k !== "raw"),
          "Raw keys:",
          token.raw ? Object.keys(token.raw) : "none"
        );
        return null;
      }

      let claims: TelegramOIDCClaims;
      try {
        if (!clientId) {
          return null;
        }
        claims = await verifyTelegramIdToken(
          token.idToken,
          clientId,
          jwksFetchTimeoutMs
        );
      } catch (e) {
        console.warn(
          "[better-auth-telegram] OIDC getUserInfo: failed to verify id_token.",
          e instanceof Error ? e.message : e
        );
        return null;
      }

      if (!claims.sub) {
        console.warn(
          "[better-auth-telegram] OIDC getUserInfo: id_token has no sub claim.",
          "Claims:",
          Object.keys(claims)
        );
        return null;
      }

      const userMap = options.mapOIDCProfileToUser
        ? options.mapOIDCProfileToUser(claims)
        : undefined;

      // Telegram OIDC doesn't provide email — generate a placeholder
      // so Better Auth's callback flow doesn't reject with "email_not_found".
      // Users can override via mapOIDCProfileToUser if they have a real email.
      const placeholderEmail = `${claims.sub}@telegram.oidc`;

      return {
        user: {
          id: claims.sub,
          name: claims.name,
          image: claims.picture,
          email: placeholderEmail,
          emailVerified: false,
          ...userMap,
        },
        data: claims,
      };
    },

    options: providerOptions,
  };
}

export { buildScopes };
