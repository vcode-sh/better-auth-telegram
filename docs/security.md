# Security

Because "trust me bro" is not a cryptographic primitive.

## Table of Contents

- [Overview](#overview)
- [HMAC Verification](#hmac-verification)
- [Replay Attack Prevention](#replay-attack-prevention)
- [Rate Limiting](#rate-limiting)
- [OIDC Security](#oidc-security)
- [Account Provisioning](#account-provisioning)
- [Token Security](#token-security)
- [Session Security](#session-security)
- [Schema Security](#schema-security)
- [Security Checklist](#security-checklist)
- [Reporting Vulnerabilities](#reporting-vulnerabilities)

## Overview

The plugin implements several layers of security so you can sleep at night instead of refreshing your error dashboard:

1. **HMAC-SHA-256 Verification** — cryptographic proof that Telegram sent the data, not some bloke with curl
2. **Timestamp Validation** — data older than `maxAuthAge` gets rejected, no exceptions. Inside that window a payload can be replayed (see [Replay Attack Prevention](#replay-attack-prevention))
3. **Rate Limiting** — every endpoint has a rate limit rule, enforced by Better Auth's limiter (on in production by default)
4. **Schema Protection** — `telegramId`, `telegramUsername` and `telegramPhoneNumber` on the user table have `input: false`, so clients cannot write to them directly
5. **Account Uniqueness** — one Telegram account, one user, and one Telegram identity per user. No double-dipping
6. **Better Auth's own gates** — users and accounts are written through Better Auth's internal adapter, so `databaseHooks` and `user.validateUserInfo` apply (before v3 they were silently bypassed)
7. **Revocable identity** — `user.telegramId` is always backed by a linked Telegram account; unlink it and the `telegramId` sign-in path closes
8. **Placeholder email guard** — the plugin's `.placeholder.invalid` addresses can't be registered or claimed by any other flow

## HMAC Verification

### How It Works

Every authentication payload from Telegram includes an HMAC-SHA-256 hash. The plugin verifies it using the **Web Crypto API** (`crypto.subtle`) — no Node.js `crypto` module, works everywhere (Node, Deno, Cloudflare Workers, edge runtimes, your toaster if it runs V8).

**Login Widget verification:**

1. Extract `hash` from the auth data; it must be exactly 64 lowercase hex characters
2. Reject the payload if any field contains a line break. Telegram's values never do, and one that did could be re-split into several fields of the data-check-string (say, a different `id`)
3. Sort remaining fields alphabetically, join as `key=value\n` pairs
4. Derive secret: `SHA-256(botToken)`
5. Verify `HMAC-SHA-256(secret, dataCheckString)` against the received hash with `crypto.subtle.verify`, which compares in constant time

```typescript
// Simplified view of what the plugin does internally (Web Crypto API)
const secretKey = new Uint8Array(
  await crypto.subtle.digest("SHA-256", encoder.encode(botToken))
);

const cryptoKey = await crypto.subtle.importKey(
  "raw", secretKey, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
);

const valid = await crypto.subtle.verify(
  "HMAC", cryptoKey, hexToBytes(hash), encoder.encode(dataCheckString)
);
```

No string `===` on hashes, so there's no timing side channel to measure.

**Mini App verification** uses a different key derivation:

1. Secret: `HMAC-SHA-256("WebAppData", botToken)` — note the literal string `"WebAppData"` as the HMAC key
2. Then: `HMAC-SHA-256(secret, sortedInitDataParams)`, where the sorted params include `signature` (as Telegram specifies), verified in constant time

Two paths, same idea: if the hash doesn't match, the request dies.

Mini App `initData` also carries an Ed25519 `signature` meant for third parties who don't have the bot token. The plugin doesn't implement that check; it has the token, and the HMAC covers `signature` anyway.

`miniApp.validateInitData: false` skips the HMAC on `/telegram/miniapp/signin`, which means anyone can sign in as any Telegram user. The plugin logs a warning at startup. Keep it for tests.

### What This Prevents

- **Data tampering** — modify a single byte and the HMAC fails
- **Source spoofing** — only someone with your bot token can produce a valid hash
- **Token exposure** — the bot token never leaves the server

## Replay Attack Prevention

Someone intercepts a valid auth payload and sends it again three days later. Classic.

The plugin checks `auth_date` against the current time. It must be an integer Unix time, no older than `maxAuthAge`, and no more than 60 seconds in the future (clock skew tolerance, not a time machine). Anything else gets rejected.

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "your_bot",
  maxAuthAge: 86400, // 24 hours (default)
})
```

Within that window a payload is a bearer credential: Telegram's docs only suggest checking `auth_date` ("To prevent the use of outdated data, you can additionally check the auth_date field"), and there's no nonce, so whoever captures a payload can replay it until it's `maxAuthAge` old.

The default is `86400` seconds (24 hours). Tighten it if you're paranoid, loosen it if you trust humanity (don't):

| Use Case | Value | Notes |
|----------|-------|-------|
| High security | `3600` (1 hour) | Banking, sensitive data |
| Standard | `86400` (24 hours) | Default — sensible for most apps |
| Relaxed | `259200` (3 days) | Social apps, lower risk |

Both Login Widget and Mini App verification paths enforce this timestamp check.

## Rate Limiting

The plugin ships **rate limit rules** for every endpoint. Better Auth applies them when its rate limiter is on, which by default means in production only (`rateLimit.enabled` defaults to `isProduction`, better-auth `context/create-context.mjs`), with per-process memory storage unless you configure `secondaryStorage` or `rateLimit.storage`. Set `rateLimit: { enabled: true }` to have them in development too.

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/telegram/signin` | 10 requests | 60 seconds |
| `/telegram/link` | 5 requests | 60 seconds |
| `/telegram/unlink` | 5 requests | 60 seconds |
| `/telegram/miniapp/signin` | 10 requests | 60 seconds |
| `/telegram/miniapp/validate` | 20 requests | 60 seconds |

These limits are enforced via Better Auth's built-in rate limiting system. Link and unlink are tighter because they're more sensitive operations.

If you need stricter limits or distributed rate limiting (multiple server instances), you can layer on additional protection at the infrastructure level — your reverse proxy, CDN, or framework middleware. But the defaults will keep the script kiddies at bay.

## OIDC Security

The OIDC flow adds a whole separate layer of cryptographic joy on top of the HMAC-based flows:

### OAuth 2.0 with PKCE

The plugin uses Authorization Code flow with Proof Key for Code Exchange (PKCE). This means:

1. Client generates a random `code_verifier` and its SHA-256 `code_challenge`
2. Authorization request includes `code_challenge` — no client secret exposed in the browser
3. Token exchange sends `code_verifier` to prove the same client that started the flow is finishing it
4. State parameter prevents CSRF on the callback

All of this is handled by Better Auth's social login system. You don't configure any of it.

### OIDC JWT Verification

The authorization request carries a nonce, and the ID token returned by the code exchange is verified **before any claim is used**. (Before v3, the callback path decoded the token without verifying it, while this page claimed otherwise. Both are fixed.)

BotFather offers `RS256` (default), `ES256`, `EdDSA` and `ES256K`. The plugin accepts `RS256`, `ES256` and `EdDSA`. `ES256K` can't be verified with Web Crypto, so it's unsupported. Verification, via `jose`:

1. Reject algorithms outside the allowlist
2. Verify the signature with a key from Telegram's JWKS (`https://oauth.telegram.org/.well-known/jwks.json`)
3. Validate `iss` (`https://oauth.telegram.org`) and `aud` (your client ID, and no other audience: OpenID Connect Core §3.1.3.7 says a token naming "additional audiences not trusted by the Client" MUST be rejected)
4. Validate `exp` and `iat` with 30 seconds of clock tolerance
5. Require `iss`, `sub`, `aud`, `exp` and `iat` to be present
6. Check `nonce` matches the one sent in the authorization request

The key set is fetched lazily and cached by jose's `createRemoteJWKSet`, which also handles refetching on unknown key ids, timeouts and cooldowns. Client-submitted ID tokens (`POST /sign-in/social` or `/link-social` with `idToken`) go through the same checks, and they must come with the `nonce` they carry. Better Auth treats that nonce as optional; the plugin doesn't, so tokens issued without a nonce are refused. Forged, nonce-less or mismatched tokens get a 401. The nonce is not replay protection here: Better Auth takes it from the request body and never checks it was issued by your server, and it sits inside the token, so whoever holds a token can resend it. Requiring it only refuses tokens issued without one. A captured token is accepted until it expires: 30 seconds measured live, plus 30 seconds of clock tolerance (the same as Better Auth's own verifier), so up to a minute after it was issued. Telegram describes its nonce as a "server-generated random string ... to prevent replay attacks" (https://core.telegram.org/bots/telegram-login); that needs a nonce your server issues and consumes once, which this path doesn't have (the redirect flow does: Better Auth generates it and binds it to the sign-in state). The path is on by default, as for Better Auth's built-in providers. If you don't use ID token sign-in, turn it off with `oidc.disableIdTokenSignIn: true`. `oidc.disableSignUp: true` restricts OIDC to existing users.

`oidc.clientSecret` is required. The old bot-token fallback is gone (Telegram never accepted it, and sending the bot token to the token endpoint was a bad idea anyway): startup warns and OIDC logins throw until the secret is set.

The token endpoint is called with HTTP Basic client authentication (`client_secret_basic`), as Telegram's docs require, so the client secret never travels in a request body. Telegram returns token errors as HTTP 200 with an `error` field; the plugin treats them as failures (Better Auth's `invalid_code` redirect) instead of pretending a token arrived.

Tokens are short-lived by design: the ID token lives 30 seconds, there's no refresh token, and the access token isn't useful for any API.

`EdDSA` and `ES256K` bots have another problem: Telegram's docs say the profile and phone scopes are rejected for them; live, the flow succeeds but the ID token contains only `iss`/`aud`/`sub`/`iat`/`exp`. The plugin logs a warning when `id` is missing. Use `RS256` or `ES256` (BotFather > your bot > Login Widget > Advanced > Signing Algorithm).

### What This Prevents

- **Token forgery** — supported signatures require Telegram's private key. Good luck with that.
- **Token replay** — in the redirect flow the nonce is generated by Better Auth and bound to the sign-in state, so a token from another authorization request is refused. A client-submitted ID token can be replayed until `exp` plus 30 seconds of clock tolerance (about a minute for Telegram's 30-second tokens); `aud` keeps tokens issued to other clients out. Turn that path off with `oidc.disableIdTokenSignIn: true` if you don't use it.
- **Authorization code interception** — PKCE makes stolen auth codes useless without the original `code_verifier`.
- **CSRF on callback** — state parameter binds the callback to the session that initiated the flow.

### Identity Mapping

`sub` is not the Telegram user id, and it differs per bot. The OIDC account is keyed by `sub`, so switching bots or client ids gives every OIDC user a new account. When the Telegram columns exist, the plugin copies the verified `id` claim to `user.telegramId` and to the `telegram-oidc` account's `telegramId`, but never overwrites a different `telegramId` and never copies an id that another user already has (it logs a warning instead). The claims are only applied to the user who owns the `telegram-oidc` account whose id is the token's `sub`; another session created in the same request doesn't get them. Mapper output can't set these fields: they're `input: false`.

Known gap: with Better Auth's `oauth-proxy` plugin, the claims are verified on the server that exchanges the code while the user is created on the other one, so the Telegram id isn't copied there.

## Account Provisioning

Login Widget and Mini App users and accounts are created through Better Auth's internal adapter, not raw adapter writes:

- `databaseHooks` (user and account create/update/delete) run; links and sign-ups are written in a transaction. A hook that vetoes a Telegram sign-up yields 403 `USER_CREATION_REJECTED`
- `user.validateUserInfo` gates every step, with `source.method` `"telegram-login-widget"` or `"telegram-mini-app"` and action `"create-user"` (sign-up), `"sign-in"` (returning user) or `"link-account"` (implicit link by `telegramId`, and `/telegram/link`). A rejection is a 403 with your code; a validator that throws fails closed with 403 `validation_failed`

Telegram sign-ins don't pass through Better Auth's `twoFactor` plugin: it only gates `/sign-in/email`, `/sign-in/username` and `/sign-in/phone-number` (better-auth `plugins/two-factor/index.mjs`), the same as Better Auth's own social sign-ins. A user with 2FA enabled who signs in with Telegram (Login Widget, Mini App or OIDC) gets a session without a second factor. If that matters, gate it yourself, for example in a `databaseHooks.session.create.before` hook that looks the user up and refuses the session (the admin plugin bans users the same way).

Mapper output (`mapTelegramDataToUser`, `mapMiniAppDataToUser`) is parsed like a Better Auth OAuth profile: it can't set the user `id` or `emailVerified` (a mapper's email is unverified), and fields that are `input: false` or unknown are dropped. A mapper email that another user already has answers 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, never a link to that user.

`/telegram/link` refuses a second, different Telegram identity (409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`). Better Auth's `account.accountLinking.enabled: false` turns it off (403 `LINKING_DISABLED`), and with `enabled: false` or `disableImplicitLinking: true` a sign-in never links itself to an existing user by `telegramId` (401 `ACCOUNT_NOT_LINKED`).

`/telegram/signin` and `/telegram/miniapp/signin` run Better Auth's `formCsrfMiddleware`, like `/sign-in/email`: a browser request from an origin outside `trustedOrigins` gets 403 `INVALID_ORIGIN` even without cookies. Without it, a page on another site could post the attacker's own fresh Telegram data (login CSRF) and sign the visitor into the attacker's account. Better Auth's JSON-only body parsing already stops plain HTML form posts (415); this covers a permissive CORS setup.

Unlinking needs a fresh session (Better Auth's `freshSessionMiddleware`, like `/unlink-account`; 403 `SESSION_NOT_FRESH` past `session.freshAge`, default 1 day), so a stolen old session can't strip the Telegram login. It refuses to remove a user's only account (400 `CANNOT_UNLINK_LAST_ACCOUNT`) unless Better Auth's `account.accountLinking.allowUnlinkingAll` is `true`.

Unlinking also revokes. Whenever a `telegram` or `telegram-oidc` account is removed — `/telegram/unlink`, Better Auth's `POST /unlink-account`, or anything else — an `account.delete` database hook re-checks the user: if no remaining Telegram account proves the stored `telegramId`, it switches to one that does or clears `telegramId`, `telegramUsername` and `telegramPhoneNumber`. Without that, a Telegram user you unlinked could sign straight back in through the `telegramId` lookup. (OIDC accounts created before v3 don't carry `account.telegramId` until their next OIDC sign-in, so until then they don't count as proof.)

Users without a real email get a placeholder (`<telegramId>@telegram.placeholder.invalid`, or `<sub>@telegram-oidc.placeholder.invalid` for OIDC) with `emailVerified: false`. `.invalid` is reserved by RFC 6761, so password-reset or magic-link mail can never be delivered to it. Database hooks guard those addresses: a user with a `@telegram.placeholder.invalid` email can only be created by the Telegram flow for that exact Telegram id, one with `@telegram-oidc.placeholder.invalid` only by the OIDC flow for that `sub`, and no user's email can be changed to a placeholder. Otherwise someone could register `<telegramId>@telegram.placeholder.invalid` with a password and block, or pre-claim, that Telegram user's account.

## Token Security

Your bot token is the key to the castle. If it leaks, someone can impersonate your bot, read messages, and generally ruin your week.

**Environment variables. Always.**

```typescript
// No
telegram({
  botToken: "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
  botUsername: "my_bot",
})

// Yes
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
})
```

**Keep it out of git:**

```gitignore
.env
.env.local
.env.*.local
```

**Use separate bots for dev and production.** Your test bot should not have access to production data, and your production bot should not be running on `localhost:3000` via ngrok.

**Rotate tokens** via @BotFather when you have to. Revoking generates the new token and retires the old one in the same step ("revoke the current token and generate a new one", [Bot Features](https://core.telegram.org/bots/features)), so deploy the new token right away. The bot token is also the HMAC key: Login Widget data and Mini App `initData` signed with the old token get 401 once the new one is live, so users sign in again and Mini Apps opened before the switch need reopening.

## Session Security

Session management is Better Auth's domain, not this plugin's. But since you're here, the basics:

```typescript
export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!, // Generate with: openssl rand -hex 32
  advanced: {
    useSecureCookies: true,     // HTTPS only in production
    // Cookie attributes go in defaultCookieAttributes; SameSite is "lax" by default.
    defaultCookieAttributes: { sameSite: "lax" },
  },
});
```

Generate a proper secret. `"password123"` is not a secret, it's a cry for help.

```bash
openssl rand -hex 32
```

## Schema Security

The user table fields `telegramId` and `telegramUsername` are defined with `input: false`. This means clients cannot set or modify these values through Better Auth's API — they're server-side only, populated during authentication.

The account table stores the provider link with `providerId: "telegram"` and enforces that a Telegram account cannot be linked to multiple users. Attempting to link an already-claimed Telegram account returns a `409 Conflict`, and so does linking a Telegram id that another user already has on their profile (for example from OIDC).

## Security Checklist

Before shipping to production — the abridged "please don't get hacked" list:

- [ ] Bot token in environment variables, not hardcoded
- [ ] `.env` files in `.gitignore`
- [ ] Strong `BETTER_AUTH_SECRET` (use `openssl rand -hex 32`)
- [ ] HTTPS enabled (Telegram requires it for the Login Widget anyway)
- [ ] Login Widget: domain configured with @BotFather (`/setdomain`). OIDC: origin and redirect URI registered as Allowed URLs (BotFather > your bot > Login Widget)
- [ ] `maxAuthAge` set appropriately for your risk profile
- [ ] Every origin that serves your login page or Mini App is in `trustedOrigins`
- [ ] `miniApp.validateInitData` left at `true`
- [ ] OIDC bot signs with `RS256` or `ES256`
- [ ] Better Auth `>=1.7.12` (GHSA-965c-763c-88jm fixed in 1.7.7; nonce enforced on every callback route from 1.7.12)
- [ ] `oidc.disableIdTokenSignIn: true` if you don't use client-side ID token sign-in
- [ ] Secure cookies enabled in production
- [ ] Separate bots for development and production
- [ ] Error logging enabled (without logging tokens or hashes, obviously)

## Reporting Vulnerabilities

Found something? Responsible disclosure, please.

1. **Do not** open a public GitHub issue
2. Email: [hello@vcode.sh](mailto:hello@vcode.sh)
3. Include: description, reproduction steps, potential impact
4. Allow time for a fix before public disclosure

We take security seriously. We take sarcasm more seriously, but security is a close second.
