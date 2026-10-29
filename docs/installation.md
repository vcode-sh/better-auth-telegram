# Installation

This page sets up the plugin step by step: packages, server, database and client, plus local development. The [quick start in the README](../README.md#quick-start-about-10-minutes) is the same path in short form.

**What you need first**

- Node.js 22 or newer (or Bun).
- A Better Auth app, or a new one. New to Better Auth? Its [installation guide](https://www.better-auth.com/docs/installation) explains the database and route handler in detail; the steps below cover the minimum.
- A Telegram bot. [Telegram bot setup](./telegram-bot-setup.md) shows how to create one in a few minutes.
- A public HTTPS address. During development, a [tunnel](#local-development-with-a-tunnel).

## 1. Install the packages

```bash
npm install better-auth-telegram better-auth
```

pnpm, yarn and bun work the same way (`pnpm add`, `yarn add`, `bun add`).

- `better-auth-telegram` v3 needs `better-auth` and `@better-auth/core` version `>=1.7.12 <1.8.0`. `@better-auth/core` is installed together with `better-auth`.
- The plugin's only other dependency is [`jose`](https://github.com/panva/jose), which checks OIDC tokens. Your package manager installs it automatically.

## 2. Configure the server

Add your bot's details to the server environment (`.env`):

```bash
TELEGRAM_BOT_TOKEN="110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"   # from BotFather
TELEGRAM_BOT_USERNAME="my_app_login_bot"                            # without the @
BETTER_AUTH_SECRET="paste the output of: openssl rand -base64 32"
BETTER_AUTH_URL="https://example.com"                               # the address users open
```

Then add the plugin to your Better Auth config:

```ts
// auth.ts
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: new DatabaseSync("./sqlite.db"), // or your own database, see below
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
    }),
  ],
});
```

This turns on the Login Widget with sensible defaults: new Telegram users are created automatically (`autoCreateUser: true`), signed-in users may link Telegram (`allowUserToLink: true`), and sign-in data older than 24 hours is refused (`maxAuthAge: 86400`). Every option is explained in [Configuration](./configuration.md).

**The database.** `node:sqlite` is SQLite built into Node.js (no flag needed from Node.js 22.13). For a real app, use your own database: a PostgreSQL or MySQL connection pool, or the Prisma, Drizzle or MongoDB adapter. [Better Auth's database docs](https://www.better-auth.com/docs/concepts/database) show each one.

**Route handler.** Better Auth needs to receive requests under `/api/auth`. In Next.js (App Router):

```ts
// app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

For other frameworks, see [Better Auth's integration guides](https://www.better-auth.com/docs/integrations/next) (Express, Hono, SvelteKit, Nuxt, Astro and more).

**Check the logs.** When the server starts, the plugin reports configuration problems through Better Auth's logger, as lines starting with `[better-auth-telegram]`. For example, it warns if `botToken` is missing or doesn't look like a bot token, or if it had to remove spaces or a newline around it. The full list is in [Configuration: startup warnings](./configuration.md#startup-warnings).

## 3. Update your database

The plugin stores Telegram details in five extra columns. They are added when the Login Widget or the Mini App is enabled (the Login Widget is enabled by default):

| Table | Column | What it holds |
|---|---|---|
| `user` | `telegramId` | The Telegram user ID, as text. Indexed, because every Login Widget and Mini App sign-in looks users up by it. |
| `user` | `telegramUsername` | The Telegram username, refreshed on every sign-in. Empty if the user has none. |
| `user` | `telegramPhoneNumber` | The phone number from OIDC, when you ask for it (digits only, no `+`). |
| `account` | `telegramId` | The Telegram user ID of this Telegram account. |
| `account` | `telegramUsername` | The Telegram username of this Telegram account. |

All five may be empty (nullable), but they **must exist**. An OIDC-only setup (`loginWidget: false` and no Mini App) adds no columns.

Let Better Auth's CLI do the work. Which command depends on how you connect to the database:

```bash
# Built-in Kysely adapter (a pg/mysql2 pool, SQLite): applies the changes directly
npx auth@latest migrate

# Prisma or Drizzle: writes the schema file, then run your ORM's migration
npx auth@latest generate

# Everyone: confirm the database matches
npx auth@latest check schema
```

`check schema` should print `Schema check passed against the live database.`

> **Why this matters.** Better Auth 1.7.3 and newer checks the database schema and answers **every** auth request with HTTP 500 until it matches. The error in your server log contains `schema mismatch` and `Missing columns`. Better Auth has a switch to turn the check off (`advanced.database.validateSchema: false`); don't use it to skip a migration, because the missing columns still break sign-in.

If you write your Prisma schema by hand, this is what the generator adds:

```prisma
model User {
  // ... your existing fields
  telegramId          String?
  telegramUsername    String?
  telegramPhoneNumber String?

  @@index([telegramId])
}

model Account {
  // ... your existing fields
  telegramId       String?
  telegramUsername String?
}
```

Then run `npx prisma migrate dev`.

### Placeholder emails

Better Auth requires every user to have a unique email address. Telegram never shares email addresses. So when a new user signs up with Telegram, the plugin gives them a placeholder:

| Sign-in method | Placeholder email |
|---|---|
| Login Widget, Mini App | `<telegram id>@telegram.placeholder.invalid`, for example `8306595751@telegram.placeholder.invalid` |
| OIDC | `<sub>@telegram-oidc.placeholder.invalid` |

What you should know:

- **Mail can never be delivered there.** The `.invalid` ending is reserved for this purpose (RFC 6761). `emailVerified` is `false`.
- **The addresses are reserved for Telegram sign-in.** No other sign-up method can create a user with one, and changing any user's email to one fails with 400 `PLACEHOLDER_EMAIL_RESERVED`. Without this rule, someone could register `8306595751@telegram.placeholder.invalid` with a password and block that Telegram user's account.
- **You can use a real email instead** by returning `email` from a mapper (`mapTelegramDataToUser`, `mapMiniAppDataToUser`, `mapOIDCProfileToUser`). The plugin never marks it verified, because Telegram didn't verify it. See [Configuration: custom user data](./configuration.md#custom-user-data).
- In your UI, treat an address ending in `.placeholder.invalid` as "no email yet", for example to ask the user for a real one.

## 4. Configure the client

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  plugins: [telegramClient()],
});
```

- `telegramClient()` takes no options. It asks your server for the bot username when it needs it, so the bot token never reaches the browser.
- **React, Vue, Svelte, Solid:** import `createAuthClient` from `better-auth/react` (or `better-auth/vue`, `better-auth/svelte`, `better-auth/solid`) to get framework hooks like `useSession()`. The Telegram helpers are the same.
- **Auth server on another domain** (for example the site at `app.example.com`, Better Auth at `api.example.com`): pass `baseURL: "https://api.example.com"` to `createAuthClient`, add `https://app.example.com` to `trustedOrigins` on the server, and allow that origin (with credentials) in your server framework's CORS settings. Better Auth's client already sends cookies with every request (`credentials: "include"`); you don't need to add it.

Next: [show the Login Widget](./usage.md), or set up [OIDC](./oidc.md) or a [Mini App](./miniapps.md).

## Local development with a tunnel

Telegram needs a public HTTPS address: BotFather's domain and redirect-URI settings don't accept `localhost`. A tunnel gives your local server one.

1. Start your app (say on port 3000), then start a tunnel:

   ```bash
   ngrok http 3000
   ```

   ngrok prints an address like `https://abc123.ngrok-free.app`. Other tunnels (Cloudflare Tunnel, localtunnel) work too.
2. Set `BETTER_AUTH_URL` to that address and restart your server.
3. Tell Telegram about it: `/setdomain` for the Login Widget, the redirect URI for OIDC (`https://abc123.ngrok-free.app/api/auth/callback/telegram-oidc`), or the Mini App URL. See [Telegram bot setup](./telegram-bot-setup.md).
4. Open the **tunnel address** in your browser, not `localhost:3000`.

> **Why step 2 and step 4 matter.** Better Auth only accepts sign-ins from trusted origins, and `BETTER_AUTH_URL` is trusted automatically. If you open `localhost:3000` while `BETTER_AUTH_URL` is the tunnel (or the other way round), sign-in fails with 403 `INVALID_ORIGIN`.

Free ngrok addresses change every time ngrok restarts. When that happens, repeat steps 2 and 3. A fixed tunnel domain saves you this.

## Check that it works

1. `npx auth@latest check schema` passes.
2. The server starts without `[better-auth-telegram]` warnings.
3. `https://<your domain>/api/auth/telegram/config` returns your bot's username, for example `{"botUsername":"my_app_login_bot","loginWidgetEnabled":true,...}`.
4. Your sign-in button appears and signing in creates a user with a `telegramId`.

If any step fails, see [Troubleshooting](./troubleshooting.md).
