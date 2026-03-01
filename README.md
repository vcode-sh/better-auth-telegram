# Better Auth Telegram

[![npm version](https://img.shields.io/npm/v/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![npm downloads](https://img.shields.io/npm/dm/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![CI](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml/badge.svg)](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/vcode-sh/better-auth-telegram/branch/main/graph/badge.svg)](https://codecov.io/gh/vcode-sh/better-auth-telegram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Telegram authentication plugin for [Better Auth](https://better-auth.com). Login Widget. Mini Apps. OIDC. Link/unlink. HMAC-SHA-256 verification. The whole circus.

Built on Web Crypto API — works in Node, Bun, Cloudflare Workers, and whatever edge runtime you're pretending to need. No `node:crypto` tantrums.

221 tests. 100% coverage. If it breaks, roast me on [X](https://x.com/vcode_sh). If it works, also roast me. I'm there either way, posting through the pain.

## Requirements

- Node.js >= 22 (or Bun, or any runtime with Web Crypto API)
- `better-auth@^1.5.0`

## Install

```bash
npm install better-auth-telegram
```

## Setup

### 1. Talk to a bot to create a bot

Message [@BotFather](https://t.me/botfather), send `/newbot`, save the token, then `/setdomain` with your domain.

For local dev you'll need [ngrok](https://ngrok.com) because Telegram demands HTTPS. Localhost? Never heard of it.

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

The plugin adds `telegramId`, `telegramUsername`, and `telegramPhoneNumber` to the `user` table, and `telegramId` and `telegramUsername` to `account`. If using Prisma:

```prisma
model User {
  // ... existing fields
  telegramId          String?
  telegramUsername    String?
  telegramPhoneNumber String?  // populated via OIDC with phone scope
}

model Account {
  // ... existing fields
  telegramId       String?
  telegramUsername  String?
}
```

Then `npx prisma migrate dev` and pray.

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

Getting "Not authenticated"? You forgot `credentials: "include"`. Go back to [Client setup](#3-client).

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

Standard OAuth 2.0 flow via `oauth.telegram.org`. Phone numbers, PKCE, RS256 JWTs — proper grown-up auth instead of widget callbacks. Telegram finally joined the federation.

#### Prerequisites

BotFather has a whole ritual for this. Skipping steps means `invalid_client` errors and Telegram silently falling back to Login Widget redirects like nothing happened. Don't skip steps.

1. Open [@BotFather](https://t.me/botfather) **as a mini app** (not the chat — the mini app). Go to **Bot Settings > Web Login**
2. Add your website URL. Then **remove it**. Yes, remove it. Close the panel, open **Web Login** again — a new option appears: **OpenID Connect Login**. This is a permanent, one-way switch. Telegram doesn't mention this anywhere because documentation is for the weak
3. Go through the OIDC setup flow. It's permanent. No going back. Commitment issues? Too late
4. Add your **Allowed URL** — your website origin (e.g., `https://example.com`). This is the trusted origin for the OAuth flow
5. Add your **Redirect URL** — your OIDC callback (e.g., `https://example.com/api/auth/callback/telegram-oidc`). If this isn't registered, Telegram returns auth codes via `#tgAuthResult` fragment instead of `?code=` query param, and your server never sees them
6. Copy your **Client ID** and **Client Secret**. They're right there on the screen. The Client Secret is NOT your bot token — BotFather generates a separate secret for OIDC. If you use the bot token, the token endpoint returns `invalid_client` and you'll spend hours debugging something that was never going to work

For local dev, point both URLs at your [ngrok](https://ngrok.com) tunnel (e.g., `https://abc123.ngrok-free.app` and `https://abc123.ngrok-free.app/api/auth/callback/telegram-oidc`). Every time ngrok restarts, you get a new URL. Update BotFather. Repeat until Stockholm syndrome sets in.

See [Telegram's official OIDC docs](https://core.telegram.org/bots/telegram-login) for the spec. It exists now. We're living in the future.

#### Setup

Enable on server:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "your_bot_username",
  oidc: {
    enabled: true,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!, // from BotFather Web Login
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

That's it. Standard Better Auth social login under the hood. PKCE, state tokens, the works. You don't even need to think about it, which is the whole point.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `botToken` | *required* | From @BotFather |
| `botUsername` | *required* | Without the @ |
| `allowUserToLink` | `true` | Let users link Telegram to existing accounts |
| `autoCreateUser` | `true` | Create user on first sign-in |
| `maxAuthAge` | `86400` | Auth data TTL in seconds (replay attack prevention) |
| `testMode` | `false` | Enable Telegram test server mode |
| `mapTelegramDataToUser` | — | Custom user data mapper |
| `miniApp.enabled` | `false` | Enable Mini Apps endpoints |
| `miniApp.validateInitData` | `true` | Verify Mini App initData |
| `miniApp.allowAutoSignin` | `true` | Allow auto sign-in from Mini Apps |
| `miniApp.mapMiniAppDataToUser` | — | Custom Mini App user mapper |
| `oidc.enabled` | `false` | Enable Telegram OIDC flow |
| `oidc.clientSecret` | — | Client Secret from BotFather Web Login (NOT the bot token) |
| `oidc.scopes` | `["openid", "profile"]` | OIDC scopes to request |
| `oidc.requestPhone` | `false` | Request phone number (adds `phone` scope) |
| `oidc.requestBotAccess` | `false` | Request bot access (adds `telegram:bot_access` scope) |
| `oidc.mapOIDCProfileToUser` | — | Custom OIDC claims mapper |

Full types in [`src/types.ts`](./src/types.ts).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/telegram/signin` | No | Sign in with widget data |
| POST | `/telegram/link` | Session | Link Telegram to account |
| POST | `/telegram/unlink` | Session | Unlink Telegram |
| GET | `/telegram/config` | No | Get bot config (username, testMode, flags) |
| POST | `/telegram/miniapp/signin` | No | Sign in from Mini App |
| POST | `/telegram/miniapp/validate` | No | Validate initData |

OIDC uses Better Auth's built-in social login routes — `POST /sign-in/social` with `provider: "telegram-oidc"` and `GET /callback/telegram-oidc`. No custom endpoints needed. Delegation at its finest.

All endpoints are rate-limited. Signin/miniapp: 10 req/60s. Link/unlink: 5 req/60s. Validate: 20 req/60s. Brute-forcing was never a strategy, now it's also a throttled one.

## Error Handling

All endpoints throw `APIError` via `APIError.from()`. The plugin exposes `$ERROR_CODES` — each code is a `RawError` object with `code` and `message` properties:

```typescript
import { telegram } from "better-auth-telegram";

const plugin = telegram({ botToken: "...", botUsername: "..." });

// In your error handler:
if (error.code === plugin.$ERROR_CODES.NOT_AUTHENTICATED.code) {
  // handle it
}
```

No more comparing against magic strings. You're welcome.

## Security

HMAC-SHA-256 verification on all auth data via Web Crypto API (`crypto.subtle`). Timestamp validation against replay attacks. Bot token never touches the client. Works in every runtime that implements the Web Crypto standard — which is all of them now, congratulations internet.

Login Widget uses `SHA256(botToken)` as secret key. Mini Apps use `HMAC-SHA256("WebAppData", botToken)`. Different derivation paths, same level of paranoia.

OIDC adds RS256 JWT verification via Telegram's JWKS endpoint, plus PKCE and state tokens for the OAuth flow. Keys are fetched and matched by `kid` — no hardcoded secrets, no trust-me-bro validation.

Is it bulletproof? No. Is it better than storing passwords in plain text? Significantly.

## Troubleshooting

**Widget not showing?** Did you `/setdomain` with @BotFather? Is `botUsername` correct (no @)? Does the container exist in DOM? Are you on HTTPS?

**Auth fails?** Wrong bot token, domain mismatch with BotFather, or `auth_date` expired (24h default). Check browser console.

**Local dev?** `ngrok http 3000`, use the ngrok URL in BotFather's `/setdomain` and as your app URL. Yes, it's annoying. Welcome to OAuth.

**OIDC returns `invalid_client`?** You haven't registered Web Login in @BotFather (Bot Settings > Web Login). Or you're using the bot token as client secret instead of the separate secret BotFather provides. See [OIDC Prerequisites](#prerequisites).

**OIDC redirects with `#tgAuthResult` instead of `?code=`?** Your redirect URI isn't registered in BotFather's Web Login Allowed URLs. Telegram falls back to Login Widget redirect mode. Register `https://yourdomain.com/api/auth/callback/telegram-oidc` in the Allowed URLs.

## Examples

See [`examples/nextjs-app/`](./examples/nextjs-app) for a Next.js implementation covering all three auth flows: Login Widget, OIDC, Mini Apps, plus account linking/unlinking. Copy-paste-ready components and server/client setup. There's also a full test playground app in [`test/`](./test) if you want to see everything wired together with a real database.

## Migrating

### To v1.4.0 (from v1.3.x)

- **OIDC users**: Add `oidc.clientSecret` — the Client Secret from BotFather's Web Login settings (Bot Settings > Web Login). This is NOT the bot token. Register your Allowed URLs there too, including `https://yourdomain.com/api/auth/callback/telegram-oidc`. The plugin falls back to bot token if `clientSecret` is omitted (with a warning), but Telegram rejects bot tokens as OIDC client secrets. Removed non-standard `origin` and `bot_id` params from the auth URL. See [OIDC Prerequisites](#prerequisites).
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
- [Telegram Login Widget](https://core.telegram.org/widgets/login)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Telegram OIDC](https://core.telegram.org/bots/features#oidc-authorization)
- [GitHub](https://github.com/vcode-sh/better-auth-telegram)
- [Changelog](./CHANGELOG.md)

## License

MIT — do whatever you want. I'm not your lawyer.

Created by [Vibe Code](https://x.com/vcode_sh).
