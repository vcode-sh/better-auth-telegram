# Installation

You want Telegram auth in your app. Bold choice. Let's get it done without a twelve-step programme.

## Prerequisites

- Node.js >= 22 (Bun works too)
- A [Better Auth](https://www.better-auth.com/) project on `better-auth` / `@better-auth/core` `>=1.7.12 <1.8.0` (1.6 is out: advisory GHSA-965c-763c-88jm is fixed only in 1.7.7; 1.7.12 enforces the ID token nonce on every callback route)
- A Telegram account (shocking, I know)

## Install

```bash
npm install better-auth-telegram better-auth
```

`@better-auth/core` comes along with `better-auth`; `jose` is the plugin's only runtime dependency and installs itself. Works with pnpm, yarn, bun -- whatever you've pledged allegiance to this month.

The v3 beta is on the `next` dist-tag: `npm install better-auth-telegram@next`.

## Create a Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot`, follow the prompts
3. Save the **bot token** -- you'll need it
4. Note the **bot username** (without the `@`)
5. For the legacy Login Widget: send `/setdomain` to BotFather, pick your bot, enter your domain. OIDC doesn't use `/setdomain`; it uses the Allowed URLs in BotFather > your bot > Login Widget ([README](../README.md#prerequisites))

Telegram demands HTTPS and a public domain. `localhost` won't cut it -- see [Local Development](#local-development-ngrok) below.

Planning to use OIDC too? Read the [OIDC prerequisites](../README.md#prerequisites) first: switching a bot to OpenID Connect in BotFather permanently disables its legacy Login Widget, so the widget and OIDC need two bots.

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

The default user mapping uses `first_name` + `last_name` for the `name` field (not `username`) and `photo_url` for `image`. Your mapper's result is merged over those defaults, so return only what you want to change:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  mapTelegramDataToUser: (data) => ({
    name: data.username || data.first_name,
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

When Login Widget or Mini App support is enabled, the plugin adds fields to **both** the `user` and `account` tables. They're optional (nullable), not optional to migrate: all five columns must exist. OIDC-only setups (`loginWidget: false`, no Mini App) add no columns.

**User table:**

| Field                 | Type     | Nullable | Notes |
| --------------------- | -------- | -------- | ----- |
| `telegramId`          | `string` | Yes      | Indexed; every Login Widget / Mini App sign-in looks users up by it |
| `telegramUsername`    | `string` | Yes      | Refreshed on every sign-in |
| `telegramPhoneNumber` | `string` | Yes      | Filled from the OIDC `phone_number` claim when `oidc.requestPhone` is on (digits only, no `+`) |

**Account table:**

| Field              | Type     | Nullable |
| ------------------ | -------- | -------- |
| `telegramId`       | `string` | Yes      |
| `telegramUsername`  | `string` | Yes      |

Better Auth >= 1.7.3 validates the schema at startup. Until it matches, every auth request fails with a 500 (`Database schema mismatch ... Missing columns`). Let Better Auth's CLI do the typing:

```bash
npx auth@latest generate      # Prisma / Drizzle: writes the schema; then run your ORM's migration
npx auth@latest migrate       # Kysely (built-in adapter): applies the changes directly
npx auth@latest check schema  # confirms the database matches
```

There is an opt-out (`advanced.database.validateSchema: false`). Don't use it to paper over a missing migration; you'll get the 500s anyway, just later and less helpfully.

Prisma example, matching what the generator outputs:

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

Then run your migration and move on with your life.

**About `email`:** Better Auth's `user.email` is required and unique, and Telegram doesn't do email. New Login Widget / Mini App users get `<telegramId>@telegram.placeholder.invalid` (`emailVerified: false`) unless your mapper returns an email; OIDC users get `<sub>@telegram-oidc.placeholder.invalid`. `.invalid` is reserved (RFC 6761), so mail can never be delivered there. The plugin's database hooks refuse those addresses everywhere else: no other sign-up method can create a user with one (so nobody can pre-register `42@telegram.placeholder.invalid` with a password and block that Telegram user), and no user's email can be changed to one.

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

For OIDC, register `https://<your tunnel host>/api/auth/callback/telegram-oidc` as a Redirect URI in BotFather > your bot > Login Widget. BotFather rejects `localhost` (with `http` and `https`), so there's no shortcut.

## Verify It Works

1. Visit your app at the ngrok URL
2. Render the Telegram widget (see [Usage](./usage.md))
3. Click it, authenticate, marvel at the session cookie

## Troubleshooting

**Widget won't appear?** Check: container element exists, bot username is correct (no `@`), domain is set in BotFather, browser console for errors.

**Auth failing?** Check: bot token is valid, domain matches BotFather config, database has the new columns (`npx auth@latest check schema`).

**Every request is a 500 with "Database schema mismatch"?** You skipped the migration. See [Database Schema](#database-schema).

**ngrok URL changed?** It does that. Update env, update BotFather, restart. Or deploy to a real host.

## Next Steps

- [Usage Examples](./usage.md) -- actually rendering the widget
- [API Reference](./api-reference.md) -- all the endpoints
- [Configuration](./configuration.md) -- every option explained
- [Security](./security.md) -- because you should care
