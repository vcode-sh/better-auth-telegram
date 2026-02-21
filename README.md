# Better Auth Telegram

[![npm version](https://img.shields.io/npm/v/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![npm downloads](https://img.shields.io/npm/dm/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![CI](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml/badge.svg)](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/vcode-sh/better-auth-telegram/branch/main/graph/badge.svg)](https://codecov.io/gh/vcode-sh/better-auth-telegram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Telegram authentication plugin for [Better Auth](https://better-auth.com). Login Widget. Mini Apps. Link/unlink. HMAC-SHA-256 verification. The whole circus.

First npm package. Shipped it scared. 110 tests. 100% coverage. If it breaks, roast me on [X](https://x.com/vcode_sh). If it works, also roast me. I'm there either way, posting through the pain.

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

The plugin adds `telegramId` and `telegramUsername` to both `user` and `account` tables. If using Prisma:

```prisma
model User {
  // ... existing fields
  telegramId       String?
  telegramUsername  String?
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

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `botToken` | *required* | From @BotFather |
| `botUsername` | *required* | Without the @ |
| `allowUserToLink` | `true` | Let users link Telegram to existing accounts |
| `autoCreateUser` | `true` | Create user on first sign-in |
| `maxAuthAge` | `86400` | Auth data TTL in seconds (replay attack prevention) |
| `mapTelegramDataToUser` | — | Custom user data mapper |
| `miniApp.enabled` | `false` | Enable Mini Apps endpoints |
| `miniApp.validateInitData` | `true` | Verify Mini App initData |
| `miniApp.allowAutoSignin` | `true` | Allow auto sign-in from Mini Apps |
| `miniApp.mapMiniAppDataToUser` | — | Custom Mini App user mapper |

Full types in [`src/types.ts`](./src/types.ts).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/telegram/signin` | No | Sign in with widget data |
| POST | `/telegram/link` | Session | Link Telegram to account |
| POST | `/telegram/unlink` | Session | Unlink Telegram |
| GET | `/telegram/config` | No | Get bot username |
| POST | `/telegram/miniapp/signin` | No | Sign in from Mini App |
| POST | `/telegram/miniapp/validate` | No | Validate initData |

## Security

HMAC-SHA-256 verification on all auth data. Timestamp validation against replay attacks. Bot token never touches the client. Secret key derived from SHA-256 hash of bot token.

Is it bulletproof? No. Is it better than storing passwords in plain text? Significantly.

## Troubleshooting

**Widget not showing?** Did you `/setdomain` with @BotFather? Is `botUsername` correct (no @)? Does the container exist in DOM? Are you on HTTPS?

**Auth fails?** Wrong bot token, domain mismatch with BotFather, or `auth_date` expired (24h default). Check browser console.

**Local dev?** `ngrok http 3000`, use the ngrok URL in BotFather's `/setdomain` and as your app URL. Yes, it's annoying. Welcome to OAuth.

## Examples

See [`examples/`](./examples) for a Next.js implementation.

## Links

- [Better Auth](https://better-auth.com)
- [Telegram Login Widget](https://core.telegram.org/widgets/login)
- [GitHub](https://github.com/vcode-sh/better-auth-telegram)

## License

MIT — do whatever you want. I'm not your lawyer.

Created by [Vibe Code](https://x.com/vcode_sh).
