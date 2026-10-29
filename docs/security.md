# Security

This page explains what the plugin checks for you, how it keeps accounts safe, and the limits you should know about. You don't have to read it to use the plugin, but read [Known limitations](#known-limitations) and the [checklist](#production-checklist) before going live.

## Contents

- [What the plugin checks](#what-the-plugin-checks)
- [Account safety rules](#account-safety-rules)
- [Your hooks run for Telegram users](#your-hooks-run-for-telegram-users)
- [Rate limits](#rate-limits)
- [Known limitations](#known-limitations)
- [Keeping secrets safe](#keeping-secrets-safe)
- [Production checklist](#production-checklist)
- [Reporting a vulnerability](#reporting-a-vulnerability)

## What the plugin checks

The plugin never trusts data from the browser. Before it signs anyone in, it proves the data came from Telegram.

### Login Widget

Telegram signs the user's details with a key derived from your bot token. The server:

1. Checks the shape: `id` (number), `first_name` (text), `auth_date` (number) and `hash` (text) must be present. Otherwise: 400 `INVALID_AUTH_DATA`.
2. Rejects any field that contains a line break. Telegram's values never do, and a line break could make one signed field look like several (for example, a different `id`).
3. Builds the "data-check-string": every field except `hash`, sorted by name, as `key=value` lines.
4. Computes `HMAC-SHA-256(key = SHA-256(bot token), data-check-string)` and compares it with `hash` in constant time (`crypto.subtle.verify`, so the comparison time reveals nothing). `hash` must be 64 lowercase hex characters.
5. Checks the age: `auth_date` must be a whole number, no older than `maxAuthAge` (default 24 hours) and no more than 60 seconds in the future (to allow for small clock differences).

Any failure in steps 2 to 5: 401 `INVALID_AUTHENTICATION`. This follows [Telegram's instructions](https://core.telegram.org/widgets/login-legacy#checking-authorization).

### Mini App

The same idea with a different key: `HMAC-SHA-256(key = "WebAppData", message = bot token)`. The data-check-string includes every field except `hash`, including `signature`, as [Telegram specifies](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). Same constant-time comparison, same age rules. Failure: 401 `INVALID_MINI_APP_INIT_DATA`.

`initData` also carries an Ed25519 `signature` that lets third parties check it without your bot token. The plugin doesn't implement that check, because it has the token and the HMAC already covers `signature`.

`miniApp.validateInitData: false` turns the check off on sign-in, which lets anyone sign in as any Telegram user. The plugin warns at startup. Use it only in automated tests.

### OIDC

The sign-in uses the Authorization Code flow with PKCE and a `state` value (both handled by Better Auth), plus a nonce. The code is exchanged with HTTP Basic client authentication, as Telegram requires, so the Client Secret is never sent in a request body. Telegram reports token errors with HTTP 200; the plugin treats them as failures.

Before using any detail from the ID token, the plugin verifies it with [`jose`](https://github.com/panva/jose):

1. The algorithm is RS256, ES256 or EdDSA (ES256K is refused: Web Crypto can't verify it).
2. The signature matches a key from Telegram's key set (`https://oauth.telegram.org/.well-known/jwks.json`, downloaded when first needed and cached).
3. The issuer is `https://oauth.telegram.org`.
4. The audience is your Client ID, **and no other** (OpenID Connect Core §3.1.3.7: a token naming other, untrusted audiences must be rejected).
5. `exp` and `iat` are valid, with 30 seconds of clock tolerance (the same as Better Auth's own verifier), and `iss`, `sub`, `aud`, `exp`, `iat` are all present.
6. The nonce matches the one sent with this sign-in.

If any check fails, Better Auth redirects with `error=unable_to_get_user_info` and the server log says which check failed.

What this prevents: forged tokens (only Telegram has the private key), tokens issued to another app (audience check), stolen authorization codes (useless without the PKCE verifier), and cross-site requests to the callback (the `state` check).

## Account safety rules

**One Telegram identity per user, one user per Telegram identity.** Linking a Telegram account that belongs to someone else answers 409 `TELEGRAM_ALREADY_LINKED_OTHER`, also when another user only has that Telegram ID on their profile (for example from OIDC). Linking a second, different Telegram account to a user answers 409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`.

**Telegram fields can't be edited by users.** `user.telegramId`, `telegramUsername` and `telegramPhoneNumber` are marked `input: false`, so Better Auth's update endpoints ignore them. Only the plugin sets them, from verified Telegram data.

**Unlinking really revokes.** Whenever a `telegram` or `telegram-oidc` account is removed, by `/telegram/unlink`, Better Auth's `/unlink-account` or any other route, a database hook re-checks the user. `user.telegramId` stays only if a remaining Telegram account proves it; otherwise it switches to one that does, or is cleared along with `telegramUsername` and `telegramPhoneNumber`. Without this, an unlinked Telegram account could still sign in through the Login Widget or Mini App, which find users by `telegramId`. (Only removals through Better Auth trigger the hook. If you delete account rows with SQL, clear `user.telegramId` yourself.)

**Unlinking needs a recent sign-in, and never strands the user.** `/telegram/unlink` requires a session younger than `session.freshAge` (403 `SESSION_NOT_FRESH`), so an old stolen session can't remove the owner's Telegram login. It refuses to remove the last sign-in method (400 `CANNOT_UNLINK_LAST_ACCOUNT`) unless you set `account.accountLinking.allowUnlinkingAll: true`.

**Placeholder emails are reserved.** Addresses ending in `@telegram.placeholder.invalid` can only be created by the Login Widget or Mini App sign-in for that exact Telegram ID, and `@telegram-oidc.placeholder.invalid` only by the OIDC sign-in for that `sub`. No user's email can be changed to one (400 `PLACEHOLDER_EMAIL_RESERVED`). Otherwise someone could register a Telegram user's placeholder address with a password and block or take over that account. `.invalid` addresses can't receive mail, so password-reset and magic-link emails can never reach them.

**Login CSRF protection.** `/telegram/signin` and `/telegram/miniapp/signin` refuse browser requests from origins that aren't trusted (403 `INVALID_ORIGIN`), even without cookies, just like Better Auth's `/sign-in/email`. Without this, a page on another site could send the attacker's own valid Telegram data to your server and sign your visitor into the attacker's account. Requests without browser origin headers (for example server-to-server calls) are not affected.

**OIDC details stay with their owner.** Details from an ID token are copied only to the user who owns the `telegram-oidc` account for that token's `sub`. A Telegram ID that already belongs to another user is never copied.

## Your hooks run for Telegram users

The plugin creates users, accounts and sessions through Better Auth's internal adapter, so your Better Auth hooks see them:

- **`databaseHooks`** run for user, account and session changes. A hook that refuses a new user (returns `false` from `user.create.before`) gives 403 `USER_CREATION_REJECTED`. A hook that refuses the session gives 401 `FAILED_TO_CREATE_SESSION`. A new user and their Telegram account are written in one transaction, as are links.
- **`user.validateUserInfo`** is called for every Login Widget and Mini App step, with `source.method` set to `"telegram-login-widget"` or `"telegram-mini-app"` and `source.action` set to:
  - `"create-user"` for a new user,
  - `"sign-in"` for a returning user,
  - `"link-account"` when a sign-in links to an existing user by `telegramId`, and on `/telegram/link`.

  Return `{ error: "your_code" }` to refuse: the client gets 403 with `your_code`. If the function throws, the request fails with 403 `validation_failed` (fail closed). OIDC sign-ins go through Better Auth's own OAuth handling, with `source.method: "oauth"`.

### Two-factor authentication

Telegram sign-ins (all three methods) don't ask for a second factor, the same as Better Auth's own social sign-ins: Better Auth's `twoFactor` plugin only guards `/sign-in/email`, `/sign-in/username` and `/sign-in/phone-number`. A user who turned on 2FA and then signs in with Telegram gets a session without a second factor. If that matters for your app, check it yourself, for example in a `databaseHooks.session.create.before` hook that looks up the user and refuses the session (the way Better Auth's admin plugin blocks banned users).

## Rate limits

The plugin registers rate limits for its endpoints:

| Endpoint | Requests per 60 seconds |
|---|---|
| `/telegram/signin` | 10 |
| `/telegram/link` | 5 |
| `/telegram/unlink` | 5 |
| `/telegram/miniapp/signin` | 10 |
| `/telegram/miniapp/validate` | 20 |

Better Auth enforces them only when its rate limiter is on. **By default that is in production only** (`rateLimit.enabled` defaults to "is production"), and counts are kept in each server process's memory unless you configure `secondaryStorage` or `rateLimit.storage`. With several servers, use shared storage, or add limits at your proxy or CDN. Set `rateLimit: { enabled: true }` to test them in development.

## Known limitations

### Replay within `maxAuthAge`

Login Widget data and Mini App `initData` contain no one-time value. Telegram's docs only suggest checking `auth_date`. So until the data is `maxAuthAge` old (24 hours by default), anyone who captures it can use it to sign in again. Keep `maxAuthAge` as short as your users can live with. For a Mini App, users simply reopen the app to get fresh data; for the Login Widget, an hour (`3600`) is often enough.

### Client-submitted OIDC ID tokens can be replayed for about a minute

ID-token sign-in (`/sign-in/social` with `idToken`) requires the token's nonce, but the nonce travels with the token, so a captured token works until it expires: 30 seconds plus 30 seconds of clock tolerance. The redirect flow is not affected. If you don't use ID-token sign-in, set `oidc.disableIdTokenSignIn: true`. Details: [OIDC](./oidc.md#sign-in-with-an-id-token-you-already-have).

### A new bot token logs everyone out of the Login Widget and Mini App

The bot token is the signing key. BotFather creates a new token by revoking the old one, so there is no overlap: once you deploy the new token, data signed with the old one is refused (401). Users sign in again, and Mini Apps opened before the switch must be reopened. Plan a short window. See [Changing the bot token](./telegram-bot-setup.md#changing-the-bot-token-later).

### Simultaneous first sign-ins on several servers

If the same new Telegram user signs in twice at the same moment (a double click, React running an effect twice), one server handles the two requests one after the other and creates one user. Across several servers, the database decides. With the built-in Kysely adapter (PostgreSQL, MySQL, SQLite) this is safe: the user and account are written in one transaction, and `user.email` is unique. On MongoDB, and on Drizzle or Prisma without `transaction: true`, two servers can still create a duplicate user or account if they sign in the same new user within milliseconds.

### Telegram signing-key rotation

When Telegram starts signing ID tokens with a new key, OIDC sign-ins can fail for up to 30 seconds: `jose` downloads the key set again at most once every 30 seconds.

### Other known gaps

- Two-factor authentication is skipped for Telegram sign-ins ([above](#two-factor-authentication)).
- Third-party Ed25519 validation of Mini App `initData` is not implemented ([above](#mini-app)).
- OIDC sign-in doesn't find an existing Login Widget or Mini App user yet ([#25](https://github.com/vcode-sh/better-auth-telegram/issues/25)).
- A user who unlinked Telegram keeps their placeholder email. If that same Telegram account signs up again, it becomes a new user with another reserved placeholder (`<telegramId>.<random>@telegram.placeholder.invalid`); the old user isn't touched.

## Keeping secrets safe

- Keep `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OIDC_CLIENT_SECRET` and `BETTER_AUTH_SECRET` in environment variables on the server, never in code, git or browser bundles. The client plugin only ever receives the bot username.
- Use separate bots for development and production, so a leaked development token can't touch production users.
- Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
- Don't log request bodies of the Telegram endpoints in production; they contain sign-in data that can be replayed (see above).

## Production checklist

- [ ] Better Auth is 1.7.12 or newer (`npm ls better-auth`).
- [ ] `npx auth@latest check schema` passes against the production database.
- [ ] The server starts without `[better-auth-telegram]` warnings.
- [ ] Secrets are in environment variables, not in code or git.
- [ ] Your site uses HTTPS, and Better Auth's cookies are secure (the default in production).
- [ ] Login Widget: your production domain is set with `/setdomain`. OIDC: the production redirect URI and origin are registered in BotFather.
- [ ] Every origin that shows a sign-in page or Mini App is `BETTER_AUTH_URL` or in `trustedOrigins`.
- [ ] `miniApp.validateInitData` is not set to `false`.
- [ ] `maxAuthAge` is as short as your users can accept.
- [ ] The OIDC bot signs with RS256 or ES256.
- [ ] `oidc.disableIdTokenSignIn: true` if you don't use ID-token sign-in.
- [ ] Rate limiting uses shared storage if you run more than one server.
- [ ] Development and production use different bots.

## Reporting a vulnerability

Please don't open a public issue. Follow [SECURITY.md](../SECURITY.md), or email [hello@vcode.sh](mailto:hello@vcode.sh) with a description, steps to reproduce and the impact you expect.
