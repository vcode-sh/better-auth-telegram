# Better Auth Telegram

[![npm version](https://img.shields.io/npm/v/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![npm downloads](https://img.shields.io/npm/dm/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![CI](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml/badge.svg)](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/vcode-sh/better-auth-telegram/branch/main/graph/badge.svg)](https://codecov.io/gh/vcode-sh/better-auth-telegram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Telegram authentication plugin for [Better Auth](https://better-auth.com). Login Widget. Mini Apps. OIDC. Link/unlink. HMAC-SHA-256 verification. The whole circus.

Built on Web Crypto API — works in Node, Bun, Cloudflare Workers, and whatever edge runtime you're pretending to need. No `node:crypto` tantrums.

355 tests, a good chunk of them against a real Better Auth instance and a fake Telegram that behaves like the live one. If it breaks, roast me on [X](https://x.com/vcode_sh). If it works, also roast me. I'm there either way, posting through the pain.

## Requirements

- Node.js >= 24 (Bun works too)
- `better-auth` and `@better-auth/core` `>=1.7.12 <1.8.0` (tested against 1.7.12 and 1.7.14)

Why not 1.6? Better Auth advisory [GHSA-965c-763c-88jm](https://github.com/advisories/GHSA-965c-763c-88jm) (account takeover via Magic Link + social sign-in) is fixed only in 1.7.7, there is no 1.6 fix, and upstream only supports the latest version. Pinning you to a vulnerable auth library would be a strange flex for an auth plugin.

## Install

```bash
npm install better-auth-telegram better-auth
```

`@better-auth/core` comes with `better-auth`. The only runtime dependency is `jose`, which npm installs for you (it is no longer bundled into `dist`).

The v3 beta lives under the `next` dist-tag: `npm install better-auth-telegram@next`.

## Setup

### 1. Talk to a bot to create a bot

Message [@BotFather](https://t.me/botfather), send `/newbot`, save the token, then `/setdomain` with your domain.

For local dev you'll need [ngrok](https://ngrok.com) (or any public HTTPS tunnel) because Telegram demands HTTPS and a real domain. Localhost? BotFather has never heard of it, and for OIDC redirect URIs it actively refuses it.

### 2. Server

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: "your_bot_username", // without @
    }),
  ],
});
```

### 3. Client

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  fetchOptions: {
    credentials: "include", // required for link/unlink
  },
  plugins: [telegramClient()],
});
```

### 4. Database

The plugin adds `telegramId` (indexed), `telegramUsername`, and `telegramPhoneNumber` to the `user` table, and `telegramId` and `telegramUsername` to `account` when Login Widget or Mini App flows are enabled (the default). They are optional, which means nullable, not "feel free to skip the migration". OIDC-only setups (`loginWidget: false`, no Mini App) add no columns at all.

Better Auth >= 1.7.3 validates the database schema at startup and answers every auth request with a 500 (`Database schema mismatch ... Missing columns`) until it matches. So generate or migrate, then check:

```bash
npx auth@latest generate      # Prisma / Drizzle: writes the schema, then run your ORM's migration
npx auth@latest migrate       # Kysely (built-in adapter): applies it directly
npx auth@latest check schema  # confirms the database matches
```

If you write Prisma by hand, this is what the generator gives you:

```prisma
model User {
  // ... existing fields
  telegramId          String?
  telegramUsername    String?
  telegramPhoneNumber String?

  @@index([telegramId])
}

model Account {
  // ... existing fields
  telegramId       String?
  telegramUsername String?
}
```

Then `npx prisma migrate dev` and pray. `advanced.database.validateSchema: false` turns the startup check off; don't, the check is the only thing standing between you and a 500 in production.

Telegram doesn't do email, Better Auth requires one. Login Widget and Mini App users get `<telegramId>@telegram.placeholder.invalid` (`emailVerified: false`) unless your mapper returns an email; OIDC users get `<sub>@telegram-oidc.placeholder.invalid`. `.invalid` is reserved by RFC 6761, so nothing can ever be mailed there.

## Usage

### Sign in

```tsx
authClient.initTelegramWidget(
  "telegram-login-container",
  { size: "large", cornerRadius: 20 },
  async (authData) => {
    const result = await authClient.signInWithTelegram(authData);
    if (!result.error) router.push("/dashboard");
  }
);
```

### Link / Unlink

```typescript
// link (user must be authenticated)
await authClient.linkTelegram(authData);

// unlink
await authClient.unlinkTelegram();
```

Getting a 401 `UNAUTHORIZED` on link/unlink? You forgot `credentials: "include"`. Go back to [Client setup](#3-client).

All API-calling client methods accept an optional `fetchOptions` parameter for custom headers, cache control, etc:

```typescript
await authClient.signInWithTelegram(authData, {
  headers: { "x-custom-header": "value" },
});
```

### Redirect flow

```typescript
authClient.initTelegramWidgetRedirect(
  "telegram-login-container",
  "/auth/telegram/callback",
  { size: "large" }
);
```

### Mini Apps

Enable on server:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "your_bot_username",
  miniApp: {
    enabled: true,
    validateInitData: true,
    allowAutoSignin: true,
  },
});
```

Then on client:

```typescript
// auto sign-in (one less click, revolutionary)
const result = await authClient.autoSignInFromMiniApp();

// or manual
const result = await authClient.signInWithMiniApp(
  window.Telegram.WebApp.initData
);

// or just validate without signing in
const validation = await authClient.validateMiniApp(
  window.Telegram.WebApp.initData
);
```

### OIDC (OpenID Connect)

Standard OAuth 2.0 Authorization Code flow via `oauth.telegram.org`. Phone numbers, PKCE, a nonce, and ID tokens verified against Telegram's JWKS — proper grown-up auth instead of widget callbacks. Telegram now calls the old iframe widget "legacy", so use OIDC for new browser integrations.

#### Prerequisites

BotFather has a whole ritual for this. Skipping steps means `invalid_client` in your server logs and an `error=invalid_code` redirect in your browser. Don't skip steps.

1. Open [@BotFather](https://t.me/botfather) **as a mini app** (not the chat — the mini app). Go to **My bots > your bot > Login Widget**
2. Press **Switch to OpenID Connect Login**. Telegram warns: "This action permanently disables the legacy login method." It means it. That bot will never render the legacy Login Widget again. Commitment issues? Too late
3. Add your **Redirect URI** — your OIDC callback, e.g. `https://example.com/api/auth/callback/telegram-oidc` (Better Auth's callback route; adjust if you changed `basePath`). It must match exactly. BotFather rejects `localhost`, over `http` and `https` alike
4. Add your site's origin (e.g. `https://example.com`) under **Trusted Origins**
5. Copy the **Client ID** (it's the bot's id) and the **Client Secret** (**Revoke** rotates it). The Client Secret is NOT your bot token. Telegram never accepted the bot token, so v3 dropped that fallback: without `oidc.clientSecret` the plugin warns at startup and refuses to start an OIDC login
6. Leave **Advanced > Signing Algorithm** on `RS256` (the default) or pick `ES256`. With `EdDSA` or `ES256K` the ID token arrives without any profile claims, and `ES256K` can't be verified at all (see [Security](#security))

**Want the legacy Login Widget and OIDC?** Then you want two bots, because step 2 burns the widget on the bot you switch. The Login Widget bot goes in `botToken` / `botUsername`, the OIDC bot in `oidc.clientId` + `oidc.clientSecret`. The plugin logs a warning if you enable both without an explicit `oidc.clientId`. Mini Apps don't care about the switch either way.

For local dev, use the HTTPS URL of a public tunnel such as [ngrok](https://ngrok.com) (e.g. `https://abc123.ngrok-free.app/api/auth/callback/telegram-oidc`). Every time ngrok restarts, you get a new URL. Update BotFather. Repeat until Stockholm syndrome sets in.

See [Telegram's "Log In With Telegram" docs](https://core.telegram.org/bots/telegram-login) for the spec. It exists now. We're living in the future.

#### Setup

Enable on server:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!, // Login Widget bot
  botUsername: "your_bot_username",
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!, // the OIDC bot: a second bot
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!, // from BotFather > Login Widget
    requestPhone: true, // get phone numbers, finally
  },
});
```

Then on client:

```typescript
await authClient.signInWithTelegramOIDC({
  callbackURL: "/dashboard",
});
```

That's it. Standard Better Auth social login under the hood. PKCE, state, nonce, HTTP Basic client authentication at the token endpoint, and ID token verification (signature, `iss`, `aud`, `exp`/`iat`, nonce) before a single claim is used. None of it needs configuration, which is the whole point.

Already have an ID token on the client? `POST /sign-in/social` with `{ provider: "telegram-oidc", idToken: { token, nonce } }` works too, verified against the same JWKS. The `nonce` is mandatory: Better Auth treats it as optional, the plugin doesn't, so a token is only accepted together with the nonce it was issued for. Forged, nonce-less or mismatched tokens get a 401. Telegram ID tokens live 30 seconds, so be quick. Don't need it? `oidc.disableIdTokenSignIn: true` rejects ID tokens on `/sign-in/social` and `/link-social`, leaving only the redirect flow.

Things Telegram won't tell you up front:

- `sub` is **not** the Telegram user id, and it's scoped per bot: the same human gets a different `sub` from each bot. Switch bots (or client ids) and every OIDC user gets a new account. The real Telegram user id is the `id` claim, a string.
- ID tokens live 30 seconds, there's no refresh token, and the access token is no use for any API (there is no userinfo endpoint).
- Phone numbers come as digits only, no leading `+`.

When the Login Widget or Mini App is enabled (so the Telegram columns exist), an OIDC sign-in, sign-up or link copies `id` to `user.telegramId`, `preferred_username` to `user.telegramUsername` and, with `requestPhone`, `phone_number` to `user.telegramPhoneNumber`. The `telegram-oidc` account row gets `telegramId` / `telegramUsername` too. The claims only ever land on the user who owns the `telegram-oidc` account whose id is the token's `sub`, never on some other session created in the same request. It never overwrites a different `telegramId` and never copies an id another user already has. That means a Login Widget or Mini App sign-in finds the user who signed up with OIDC.

`user.telegramId` is always backed by a linked Telegram account. Remove any `telegram` or `telegram-oidc` account (`/telegram/unlink`, Better Auth's `POST /unlink-account`, or anything else) and a database hook re-checks the user: if no remaining Telegram account proves the stored id, it switches to one that does or clears `telegramId`, `telegramUsername` and `telegramPhoneNumber`. Unlinking really revokes Login Widget / Mini App sign-in. OIDC accounts created before v3 don't carry `account.telegramId` until their next OIDC sign-in.

Known limitations:

- An OIDC sign-in doesn't find an existing Login Widget / Mini App user yet ([#25](https://github.com/vcode-sh/better-auth-telegram/issues/25), the reverse direction). Better Auth matches OAuth accounts by provider account id and then by verified email only.
- With Better Auth's `oauth-proxy` plugin, the Telegram id is not copied onto the user: the claims are verified on the server that exchanges the code, and the user is created on the other one.
- Better Auth's `/account-info` stops working for `telegram-oidc` after about 30 seconds: Telegram issues 30-second tokens and no refresh token.

#### OIDC-only mode

Don't need the Login Widget? Set `loginWidget: false` (and leave Mini Apps off) and skip the widget endpoints, rate limits, and the 5 Telegram-specific database columns entirely. Pure OIDC, no baggage:

```typescript
// OIDC-only (no widget endpoints, no extra schema fields)
telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
  },
});
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `botToken` | — | Required at runtime for Login Widget and Mini App HMAC verification; can provide the OIDC client ID fallback |
| `botUsername` | — | Required only when rendering the Login Widget; without the @ |
| `allowUserToLink` | `true` | Let users link Telegram to existing accounts |
| `autoCreateUser` | `true` | Create user on first sign-in |
| `maxAuthAge` | `86400` | Auth data TTL in seconds (replay attack prevention) |
| `testMode` | `false` | Informational flag returned by `GET /telegram/config`; changes no verification or widget behavior |
| `loginWidget` | `true` | Enable Login Widget endpoints and schema fields |
| `mapTelegramDataToUser` | — | Custom user data mapper, merged over the defaults (name, image) |
| `miniApp.enabled` | `false` | Enable Mini Apps endpoints |
| `miniApp.validateInitData` | `true` | Verify Mini App initData. `false` means anyone can sign in as any Telegram user (startup warning) |
| `miniApp.allowAutoSignin` | `true` | Allow auto sign-in from Mini Apps |
| `miniApp.mapMiniAppDataToUser` | — | Custom Mini App user mapper, merged over the defaults |
| `oidc.enabled` | `false` | Enable Telegram OIDC flow |
| `oidc.clientId` | — | Client ID from BotFather > your bot > Login Widget (the bot's id); falls back to the bot ID in `botToken` |
| `oidc.clientSecret` | — | **Required.** Client Secret from the same page (NOT the bot token; there's no fallback). Startup warns and login throws until it's set |
| `oidc.disableIdTokenSignIn` | `false` | Reject client-submitted ID tokens on `/sign-in/social` and `/link-social` |
| `oidc.disableSignUp` | `false` | Only sign in existing users; never create one from OIDC |
| `oidc.overrideUserInfoOnSignIn` | `false` | Refresh name and photo from Telegram on every OIDC sign-in |
| `oidc.scopes` | `["openid", "profile"]` | OIDC scopes to request (`openid` is always added) |
| `oidc.requestPhone` | `false` | Request phone number (adds `phone` scope) |
| `oidc.requestBotAccess` | `false` | Request bot access (adds `telegram:bot_access` scope) |
| `oidc.mapOIDCProfileToUser` | — | Customize `name` / `email` / `image` from the claims; any `id` it returns is ignored |

Full types in [`src/types.ts`](./src/types.ts).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/telegram/signin` | No | Sign in with widget data (when `loginWidget` enabled) |
| POST | `/telegram/link` | Session | Link Telegram to account (when `loginWidget` enabled) |
| POST | `/telegram/unlink` | Fresh session | Unlink Telegram (when `loginWidget` enabled) |
| GET | `/telegram/config` | No | Get bot config (username, `testMode`, enabled-flow flags) |
| POST | `/telegram/miniapp/signin` | No | Sign in from Mini App |
| POST | `/telegram/miniapp/validate` | No | Validate initData |

OIDC uses Better Auth's built-in social login routes — `POST /sign-in/social` with `provider: "telegram-oidc"` and `GET /callback/telegram-oidc`. No custom endpoints needed. Delegation at its finest.

Login Widget and Mini App writes go through Better Auth's internal adapter (link and create in a transaction), so your `databaseHooks` (user/account create, update and delete) run. A hook that vetoes a Telegram sign-up gets you 403 `USER_CREATION_REJECTED`. `user.validateUserInfo` sees every step, with `source.method` `"telegram-login-widget"` or `"telegram-mini-app"` and `source.action`:

- `"create-user"` for sign-ups;
- `"sign-in"` for returning users;
- `"link-account"` when a sign-in links to an existing user by `telegramId`, and on `/telegram/link`.

It fails closed: a validator that throws means 403 `validation_failed`. Every sign-in also refreshes the stored `telegramUsername`, since Telegram users rename themselves whenever they like.

One Telegram user per account: `/telegram/link` with a different Telegram id than the user already has answers 409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`.

`/telegram/unlink` uses Better Auth's `freshSessionMiddleware`, like `/unlink-account`: a session older than `session.freshAge` (default 1 day) gets 403 `SESSION_NOT_FRESH`. It also won't remove a user's only account (400 `CANNOT_UNLINK_LAST_ACCOUNT`) unless Better Auth's `account.accountLinking.allowUnlinkingAll` is `true`. Locking people out of their own account is a feature you have to opt into.

The `<id>@telegram.placeholder.invalid` and `<sub>@telegram-oidc.placeholder.invalid` addresses belong to the plugin. Database hooks refuse to create a user with one unless it's the Telegram flow for that exact Telegram id (or the OIDC flow for that `sub`), and refuse to change anyone's email to one (400 `PLACEHOLDER_EMAIL_RESERVED`). Nobody gets to register `42@telegram.placeholder.invalid` with a password and squat on a Telegram user's account.

All endpoints are rate-limited. Signin/miniapp: 10 req/60s. Link/unlink: 5 req/60s. Validate: 20 req/60s. Brute-forcing was never a strategy, now it's also a throttled one.

## Error Handling

All endpoints throw `APIError` via `APIError.from()`. The plugin exposes `$ERROR_CODES` — each code is a `RawError` object with `code` and `message` properties:

```typescript
import { telegram } from "better-auth-telegram";

const plugin = telegram({ botToken: "...", botUsername: "..." });

// In your error handler:
if (error.code === plugin.$ERROR_CODES.CANNOT_UNLINK_LAST_ACCOUNT.code) {
  // tell the user to add another sign-in method first
}
```

No more comparing against magic strings. You're welcome.

## Security

HMAC-SHA-256 verification on all auth data via Web Crypto API (`crypto.subtle`), compared in constant time (`crypto.subtle.verify`). The hash must be 64 lowercase hex characters, Login Widget fields containing a line break are rejected (so nobody can re-split the data-check-string), and `auth_date` must be an integer Unix time no older than `maxAuthAge` and no more than 60 seconds in the future. Bot token never touches the client. Works in every runtime that implements the Web Crypto standard — which is all of them now, congratulations internet.

Login Widget uses `SHA256(botToken)` as secret key. Mini Apps use `HMAC-SHA256("WebAppData", botToken)`, and the Mini App data-check-string includes `signature`, as Telegram specifies. Third-party Ed25519 validation of that `signature` is not implemented; the HMAC `hash` check already covers it. Different derivation paths, same level of paranoia.

OIDC sends a nonce and verifies the ID token from the code exchange before using any claim: signature against Telegram's JWKS (`https://oauth.telegram.org/.well-known/jwks.json`, cached by jose's `createRemoteJWKSet`), `iss`, `aud` (your client id), `exp`/`iat` with 30 seconds of clock tolerance, the required claims `iss`/`sub`/`aud`/`exp`/`iat`, and the nonce. Accepted algorithms: `RS256`, `ES256`, `EdDSA`. `ES256K` is offered by BotFather but Web Crypto can't verify it, so it's unsupported. Before v3 the callback path decoded the token without verifying it while these docs said otherwise; that's fixed, and so are the docs.

Is it bulletproof? No. Is it better than storing passwords in plain text? Significantly.

## Troubleshooting

**Widget not showing?** Did you `/setdomain` with @BotFather? Is `botUsername` correct (no @)? Does the container exist in DOM? Are you on HTTPS?

**Auth fails?** Wrong bot token, domain mismatch with BotFather, or `auth_date` expired (24h default). Check browser console.

**Every auth request returns 500 with `Database schema mismatch ... Missing columns`?** Better Auth >= 1.7.3 checks the schema at startup. Run `npx auth@latest generate` (Prisma/Drizzle) or `npx auth@latest migrate` (Kysely), then `npx auth@latest check schema`. See [Database](#4-database).

**Widget / Mini App sign-in returned 500 and your database complains about `email` being NULL (v2.x)?** v2 created those users without an email, which only the memory adapter tolerated. v3 stores a placeholder email. Upgrade.

**Local dev?** `ngrok http 3000`, use the ngrok URL in BotFather's `/setdomain` and as your app URL. Yes, it's annoying. Welcome to OAuth. BotFather rejects `localhost` redirect URIs for OIDC, so a tunnel isn't optional there.

**OIDC lands on `error=invalid_code`?** Telegram reports token errors with HTTP 200 and `{"error": "..."}`; the plugin turns that into Better Auth's `invalid_code`. The server log says which: `invalid_client` means `oidc.clientSecret` isn't the current Client Secret from BotFather > your bot > Login Widget (the bot token, or a revoked secret), the client id is wrong, or the bot was never switched to OpenID Connect. See [OIDC Prerequisites](#prerequisites).

**OIDC redirects with `#tgAuthResult` instead of `?code=`?** Your redirect URI isn't registered under Redirect URIs in BotFather > your bot > Login Widget. Register `https://yourdomain.com/api/auth/callback/telegram-oidc`, exactly.

**OIDC users have no name, username or `telegramId`?** Your bot signs ID tokens with `EdDSA` (or `ES256K`), and Telegram then drops every profile claim, leaving `iss`/`aud`/`sub`/`iat`/`exp`. The plugin logs a warning. Switch to `RS256` or `ES256` in BotFather > your bot > Login Widget > Advanced > Signing Algorithm.

**Unlink returns 400 `CANNOT_UNLINK_LAST_ACCOUNT`?** Telegram is the user's only way in. Add another sign-in method first, or set Better Auth's `account.accountLinking.allowUnlinkingAll: true` if stranding users is really what you want.

**Unlink returns 403 `SESSION_NOT_FRESH`?** The session is older than `session.freshAge` (default 1 day). Have the user sign in again, then unlink.

**Link returns 409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`?** The user already has a different Telegram account. One per user; unlink the old one first.

**ID token sign-in returns 401?** Bad signature, expired (they live 30 seconds), or you didn't pass the `nonce` the token was issued for. `idToken: { token, nonce }`, both.

## Examples

See [`examples/nextjs-app/`](./examples/nextjs-app) for a Next.js implementation covering all three auth flows: Login Widget, OIDC, Mini Apps, plus account linking/unlinking. Copy-paste-ready components and server/client setup. There's also a full test playground app in [`test/`](./test) if you want to see everything wired together with a real database.

## Migrating

### To v3.0.0 (from v2.x)

`3.0.0-beta.0` is published under the npm dist-tag `next`: `npm install better-auth-telegram@next`.

1. **Upgrade Better Auth to `>=1.7.12 <1.8.0`** (`better-auth` and `@better-auth/core`). 1.6 is dropped: GHSA-965c-763c-88jm is only fixed in 1.7.7, and 1.7.12 is the first release whose `oauth-proxy` callback enforces the ID token nonce. Node.js >= 24.
2. **Regenerate or migrate the schema, then check it.** `npx auth@latest generate` (Prisma/Drizzle) or `npx auth@latest migrate` (Kysely), then `npx auth@latest check schema`. Better Auth >= 1.7.3 answers every request with a 500 until all five Telegram columns exist (when the Login Widget or Mini App is enabled). `user.telegramId` now has an index; Prisma users add `@@index([telegramId])`.
3. **Review your `databaseHooks` and `user.validateUserInfo`.** Login Widget and Mini App users and accounts are now created through Better Auth's internal adapter, so both apply (`source.method` is `"telegram-login-widget"` or `"telegram-mini-app"`). Before v3 they were silently bypassed. `validateUserInfo` now sees `"sign-in"` for returning users and `"link-account"` for links, not just `"create-user"`, and a throwing validator means 403. A hook that vetoes a Telegram sign-up yields 403 `USER_CREATION_REJECTED`.
4. **Expect placeholder emails.** New Login Widget / Mini App users get `<telegramId>@telegram.placeholder.invalid` unless your mapper returns an email (v2 created them without one, which failed on every SQL database Better Auth's CLI generates). New OIDC users get `<sub>@telegram-oidc.placeholder.invalid` instead of `<sub>@telegram.oidc`; existing users keep their stored email, and accounts are matched by provider account id, so nothing breaks.
5. **Unlink is guarded and actually revokes.** `/telegram/unlink` needs a fresh session (403 `SESSION_NOT_FRESH` otherwise, `session.freshAge`, default 1 day) and returns 400 `CANNOT_UNLINK_LAST_ACCOUNT` for a user's only account unless `account.accountLinking.allowUnlinkingAll` is `true`. Removing any Telegram account, by any route, re-checks `user.telegramId` and clears it when no Telegram account still proves it.
6. **One Telegram identity per user.** `/telegram/link` with a different Telegram id than the user already has returns 409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`, and 409 `TELEGRAM_ALREADY_LINKED_OTHER` when another user already has that `telegramId` on their profile.
7. **Mappers merge.** `mapTelegramDataToUser` and `mapMiniAppDataToUser` results are merged over the defaults (name from first/last name, image from `photo_url`) instead of replacing them.
8. **OIDC:** `oidc.clientSecret` is now required; the bot-token fallback is gone (Telegram never accepted it). HTTP Basic client authentication, the nonce and ID token verification need no configuration. Client-submitted ID tokens need their nonce: `idToken: { token, nonce }`. BotFather's page is **your bot > Login Widget**, not "Web Login". If you also use the legacy Login Widget, you need a second bot for OIDC (`oidc.clientId` + `oidc.clientSecret`). `TelegramOIDCClaims.id` is now a `string`. Delete any `mapOIDCProfileToUser` code that returns `telegramId` or `telegramPhoneNumber`: those fields are `input: false`, Better Auth always dropped them, and the plugin now fills them itself whenever those columns exist.

### To v2.0.0 (from v1.5.0)

- Upgrade Better Auth to `>=1.6.22 <1.7.0`. Better Auth 1.7 is not supported by this release.
- `botToken` and `botUsername` are now flow-aware. Missing values log setup warnings; the affected Widget, Mini App, or OIDC operation rejects if the credential is still missing when used.
- OIDC-only setups can omit both bot fields when `oidc.clientId` and `oidc.clientSecret` are configured explicitly.

### To v1.5.0 (from v1.4.0)

- No breaking changes. New `loginWidget` option defaults to `true` — existing setups are unaffected.
- OIDC-only users can now set `loginWidget: false` to skip Widget endpoints and the 5 Telegram-specific database columns (`telegramId`, `telegramUsername`, `telegramPhoneNumber` on user; `telegramId`, `telegramUsername` on account).
- Config endpoint now returns `loginWidgetEnabled` boolean. Client `getTelegramConfig` type updated accordingly.

### To v1.4.0 (from v1.3.x)

- **OIDC users**: Add `oidc.clientSecret` — the Client Secret from BotFather's bot settings (today: your bot > Login Widget). This is NOT the bot token. Register your Allowed URLs there too, including `https://yourdomain.com/api/auth/callback/telegram-oidc`. The plugin fell back to the bot token if `clientSecret` was omitted (with a warning; the fallback is gone in v3), but Telegram rejects bot tokens as OIDC client secrets. Removed non-standard `origin` and `bot_id` params from the auth URL. See [OIDC Prerequisites](#prerequisites).
- Login Widget and Mini App flows are unaffected.

### To v1.3.x (from v1.2.0)

- No breaking changes. v1.3.x added graceful `verifyIdToken` failure, placeholder email generation, diagnostic `getUserInfo` logging, and `origin` param (now removed in v1.4.0). If you're using OIDC, skip straight to v1.4.0.

### To v1.2.0 (from v1.1.0)

- No breaking changes. `testMode` is opt-in (default `false`). `BetterAuthPluginRegistry` module augmentation is type-only — zero runtime impact. Config endpoint now returns `testMode` boolean. Your existing code doesn't care.

### To v1.1.0 (from v1.0.0)

- **Peer dep bumped to `better-auth@^1.5.0`** — upgrade better-auth first, then update the plugin. The `$ERROR_CODES` type changed from `Record<string, string>` to `Record<string, RawError>` and this release follows suit.

### To v1.0.0 (from v0.4.0)

- No breaking changes. OIDC is opt-in (`oidc.enabled: false` by default). Add `telegramPhoneNumber` column to your user table if you plan to use OIDC with phone scope.

### To v0.4.0 (from v0.3.x)

- **Verification functions are now async** — `verifyTelegramAuth()` and `verifyMiniAppInitData()` return `Promise<boolean>`. Slap an `await` in front if you're calling them directly.
- **Errors throw `APIError`** — all endpoints throw `APIError` instead of returning `ctx.json({ error })`. Switch to Better Auth's standard error shape.
- **ESM-first** — `"type": "module"` in package.json. CJS still works via `.cjs` exports.

Full changelog in [CHANGELOG.md](./CHANGELOG.md).

## Links

- [Better Auth](https://better-auth.com)
- [Telegram Login Widget (legacy)](https://core.telegram.org/widgets/login-legacy)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Log In With Telegram (OIDC)](https://core.telegram.org/bots/telegram-login)
- [GitHub](https://github.com/vcode-sh/better-auth-telegram)
- [Changelog](./CHANGELOG.md)

## License

MIT — do whatever you want. I'm not your lawyer.

Created by [Vibe Code](https://x.com/vcode_sh).
