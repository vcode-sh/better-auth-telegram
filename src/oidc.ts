import type {
  OAuth2Tokens,
  OAuthIdTokenConfig,
  OAuthProvider,
} from "@better-auth/core/oauth2";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
} from "@better-auth/core/oauth2";
import { createPlaceholderEmail } from "@better-auth/core/utils/email";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  TELEGRAM_OIDC_AUTH_ENDPOINT,
  TELEGRAM_OIDC_ISSUER,
  TELEGRAM_OIDC_JWKS_URI,
  TELEGRAM_OIDC_PROVIDER_ID,
  TELEGRAM_OIDC_TOKEN_ENDPOINT,
} from "./constants";
import { rememberVerifiedClaims } from "./telegram-identity";
import type { TelegramOIDCClaims, TelegramOIDCOptions } from "./types";

const LOG_PREFIX = "[better-auth-telegram] OIDC:";

/**
 * Algorithms Telegram can sign ID tokens with that Web Crypto can verify.
 * ES256K (secp256k1) is offered by @BotFather but has no Web Crypto support.
 */
const SUPPORTED_SIGNING_ALGORITHMS = ["RS256", "ES256", "EdDSA"];

/** Matches Better Auth's own ID token verifier. */
const ID_TOKEN_CLOCK_TOLERANCE_SECONDS = 30;
const ID_TOKEN_REQUIRED_CLAIMS = ["iss", "sub", "aud", "exp", "iat"];

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

function displayName(claims: TelegramOIDCClaims): string | undefined {
  if (claims.name) {
    return claims.name;
  }
  const fullName = [claims.given_name, claims.family_name]
    .filter(Boolean)
    .join(" ");
  return fullName || claims.preferred_username;
}

/**
 * Creates a Telegram OIDC provider for Better Auth's social login system.
 *
 * Authorization Code flow with PKCE and a nonce via oauth.telegram.org.
 * The token endpoint is called with HTTP Basic client authentication, and
 * the returned ID token is verified against Telegram's JWKS (signature,
 * issuer, audience, expiry, nonce) before any claim is trusted.
 *
 * @param botToken - Bot token from @BotFather (bot ID is the default client_id)
 * @param options - OIDC configuration options
 */
export function createTelegramOIDCProvider(
  botToken: string,
  options: TelegramOIDCOptions = {}
): OAuthProvider<TelegramOIDCClaims> {
  const botId = botToken.split(":")[0]!;

  // Client ID and secret come from @BotFather (your bot > Login Widget).
  // The client ID defaults to the bot id; there is no default secret —
  // Telegram rejects the bot token as a client secret.
  const clientId = options.clientId || botId;
  const clientSecret = options.clientSecret ?? "";

  const providerOptions = {
    clientId,
    clientSecret,
    disableIdTokenSignIn: options.disableIdTokenSignIn,
    disableSignUp: options.disableSignUp,
    overrideUserInfoOnSignIn: options.overrideUserInfoOnSignIn,
  };

  const requireOIDCCredentials = () => {
    if (!clientId) {
      throw new Error(
        `${LOG_PREFIX} clientId is required before starting an OIDC login.`
      );
    }
    if (!clientSecret) {
      throw new Error(
        `${LOG_PREFIX} clientSecret is required before starting an OIDC login.`
      );
    }
  };

  // Fetched lazily, cached and rate limited by jose; shared by every request
  // served by this Better Auth instance.
  const jwks = createRemoteJWKSet(new URL(TELEGRAM_OIDC_JWKS_URI));

  const verifyIdToken = async (
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
    // OIDC Core 3.1.3.7: reject a token that also names audiences we don't
    // trust (jose only checks that ours is among them).
    if ([payload.aud].flat().some((audience) => audience !== clientId)) {
      throw new Error("ID token is also issued to another audience");
    }
    if (expectedNonce !== undefined && payload.nonce !== expectedNonce) {
      throw new Error(
        "ID token nonce does not match the authorization request"
      );
    }
    return payload as unknown as TelegramOIDCClaims;
  };

  // Client-submitted ID tokens (POST /sign-in/social and /link-social with
  // `idToken`). Better Auth treats the nonce as optional; Telegram tokens are
  // bearer credentials, so a token is only accepted together with the nonce
  // it was issued for.
  const idToken: OAuthIdTokenConfig = {
    async verify(token, nonce) {
      if (!nonce) {
        return false;
      }
      try {
        await verifyIdToken(token, nonce);
        return true;
      } catch {
        return false;
      }
    },
  };

  return {
    id: TELEGRAM_OIDC_PROVIDER_ID,
    name: "Telegram",
    issuer: TELEGRAM_OIDC_ISSUER,
    requiresIdTokenNonce: true,
    idToken,

    accountSubject({ profile }) {
      if (typeof profile.sub !== "string" || !profile.sub.trim()) {
        throw new Error(`${LOG_PREFIX} ID token has no subject`);
      }
      return profile.sub;
    },

    createAuthorizationURL({
      state,
      codeVerifier,
      scopes,
      redirectURI,
      idTokenNonce,
    }) {
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
        nonce: idTokenNonce,
      });
    },

    async validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      requireOIDCCredentials();

      const tokens = await validateAuthorizationCode({
        code,
        codeVerifier,
        redirectURI,
        options: providerOptions,
        tokenEndpoint: TELEGRAM_OIDC_TOKEN_ENDPOINT,
        authentication: "basic",
      });

      // Telegram reports token errors with HTTP 200 and an `error` field.
      const error = tokens.raw?.error;
      if (error) {
        throw new Error(
          `${LOG_PREFIX} token endpoint returned "${String(error)}"`
        );
      }
      return tokens;
    },

    async getUserInfo(
      token: OAuth2Tokens & { expectedIdTokenNonce?: string | undefined }
    ) {
      if (!token.idToken) {
        console.warn(
          `${LOG_PREFIX} getUserInfo: no id_token in the token response.`
        );
        return null;
      }

      let claims: TelegramOIDCClaims;
      try {
        claims = await verifyIdToken(token.idToken, token.expectedIdTokenNonce);
      } catch (error) {
        console.warn(
          `${LOG_PREFIX} getUserInfo: rejected id_token.`,
          error instanceof Error ? error.message : error
        );
        return null;
      }

      if (claims.id === undefined) {
        console.warn(
          `${LOG_PREFIX} the ID token has no profile claims (id, name, username).`,
          "Telegram drops them for bots that sign with EdDSA or ES256K;",
          "use RS256 or ES256 in @BotFather (Login Widget > Advanced)."
        );
      }

      await rememberVerifiedClaims(claims);

      const { id: _ignored, ...mapped } =
        options.mapOIDCProfileToUser?.(claims) ?? {};

      return {
        user: {
          name: displayName(claims),
          image: claims.picture,
          // Telegram OIDC has no email claim; Better Auth requires one.
          email: createPlaceholderEmail({
            identifier: claims.sub,
            namespace: TELEGRAM_OIDC_PROVIDER_ID,
          }),
          emailVerified: false,
          ...mapped,
        },
        data: claims,
      };
    },

    options: providerOptions,
  };
}
