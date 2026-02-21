# Installation

You want Telegram auth in your app. Bold choice. Let's get it done without a twelve-step programme.

## Prerequisites

- Node.js >= 22
- A [Better Auth](https://www.better-auth.com/) project (v1.4.18+)
- A Telegram account (shocking, I know)

## Install

```bash
npm install better-auth-telegram
```

Works with pnpm, yarn, bun -- whatever you've pledged allegiance to this month.

## Create a Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot`, follow the prompts
3. Save the **bot token** -- you'll need it
4. Note the **bot username** (without the `@`)
5. Send `/setdomain` to BotFather, pick your bot, enter your domain

Telegram demands HTTPS and a public domain. `localhost` won't cut it -- see [Local Development](#local-development-ngrok) below.

## Environment Variables

```env
TELEGRAM_BOT_TOKEN="your_bot_token_from_botfather"
TELEGRAM_BOT_USERNAME="your_bot_username"
```

## Server Plugin

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  // ...your database, secret, etc.
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,
    }),
  ],
});
```

That's the minimum. The defaults are sensible: `autoCreateUser: true`, `allowUserToLink: true`, `maxAuthAge: 86400` (24 hours).

The default user mapping uses `first_name` + `last_name` for the `name` field (not `username`). Override it if you want:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  mapTelegramDataToUser: (data) => ({
    name: data.username || data.first_name,
    image: data.photo_url,
  }),
}),
```

## Client Plugin

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  plugins: [telegramClient()],
});
```

No secret handshakes required. The client fetches bot config from your server automatically.

## Database Schema

The plugin adds two nullable fields to **both** the `user` and `account` tables:

| Field              | Type     | Nullable |
| ------------------ | -------- | -------- |
| `telegramId`       | `string` | Yes      |
| `telegramUsername`  | `string` | Yes      |

If you use Better Auth's CLI to generate migrations, it handles this for you. Otherwise, add those four columns (two per table) to your database however your ORM of choice demands.

Prisma example -- add to both `User` and `Account` models:

```prisma
telegramId       String?
telegramUsername  String?
```

Then run your migration and move on with your life.

## Local Development (ngrok)

Telegram requires HTTPS. Your `localhost:3000` is not HTTPS. ngrok fixes this.

```bash
ngrok http 3000
```

Take the HTTPS URL ngrok gives you (e.g. `https://abc123.ngrok-free.app`) and:

1. Set it as `BETTER_AUTH_URL` in your env
2. Tell BotFather via `/setdomain` (domain only, no `https://`)
3. Restart your dev server

Free ngrok gives you a new URL every time. Pay for a static domain or just accept your chaotic lifestyle.

## Verify It Works

1. Visit your app at the ngrok URL
2. Render the Telegram widget (see [Usage](./usage.md))
3. Click it, authenticate, marvel at the session cookie

## Troubleshooting

**Widget won't appear?** Check: container element exists, bot username is correct (no `@`), domain is set in BotFather, browser console for errors.

**Auth failing?** Check: bot token is valid, domain matches BotFather config, database has the new columns.

**ngrok URL changed?** It does that. Update env, update BotFather, restart. Or deploy to a real host.

## Next Steps

- [Usage Examples](./usage.md) -- actually rendering the widget
- [API Reference](./api-reference.md) -- all the endpoints
- [Configuration](./configuration.md) -- every option explained
- [Security](./security.md) -- because you should care
