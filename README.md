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

Enable on server:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "your_bot_username",
  oidc: {
    enabled: true,
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

## Examples

See [`examples/`](./examples) for a Next.js implementation.

## Migrating

### To v1.3.x (from v1.2.0)

- No breaking changes. v1.3.2 fixes the real cause of the OIDC "Unable to get user info" error — Telegram's auth endpoint expects `bot_id`, not `client_id`, so the token response was missing `id_token`. Also adds diagnostic `console.warn` when `getUserInfo` returns null. v1.3.1 wraps `verifyIdToken` in a try-catch. v1.3.0 adds placeholder email generation, `origin` parameter, and JWT decode error handling. If you're using OIDC, upgrade to 1.3.2. If you're not, your code doesn't care.

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
