# Better Auth Telegram

[![npm version](https://img.shields.io/npm/v/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![npm downloads](https://img.shields.io/npm/dm/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![CI](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml/badge.svg)](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/vcode-sh/better-auth-telegram/branch/main/graph/badge.svg)](https://codecov.io/gh/vcode-sh/better-auth-telegram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Let people sign in to your app with their Telegram account.**

`better-auth-telegram` is a plugin for [Better Auth](https://www.better-auth.com), the TypeScript authentication library. You add it to your Better Auth setup, and your users can sign in with Telegram in any of three ways. The plugin checks that every sign-in really comes from Telegram, creates the user in your database, and starts a normal Better Auth session.

- Uses the standard Web Crypto API; release tests run on Node.js and Bun.
- Tested with SQLite, PostgreSQL, MySQL, Drizzle, Prisma and MongoDB. Other Better Auth adapters need their own deployment checks.
- Fully typed: `session.user.telegramId` is known to TypeScript on the server and in the browser.

> **Upgrading from v2?** Read the [v2 to v3 migration guide](docs/migration-v2-to-v3.md). v3 requires Better Auth 1.7, which fixes a critical security issue.

## Contents

- [Which sign-in method should I use?](#which-sign-in-method-should-i-use)
- [Requirements](#requirements)
- [Quick start (about 10 minutes)](#quick-start-about-10-minutes)
- [The other sign-in methods](#the-other-sign-in-methods)
- [What the plugin stores](#what-the-plugin-stores)
- [Documentation](#documentation)
- [Upgrading from v2](#upgrading-from-v2)

## Which sign-in method should I use?

Telegram offers three ways to sign in. The plugin supports all of them, and you can turn on more than one.

| | Login Widget | Mini App | OIDC ("Log In With Telegram") |
|---|---|---|---|
| **Where your app runs** | Your website | Inside the Telegram app | Your website |
| **What the user does** | Clicks a Telegram button on your page and confirms | Nothing. Opening the app signs them in | Clicks your button, confirms on Telegram's login page, comes back |
| **Phone number** | No | No | Yes, if the user agrees |
| **Telegram's status** | Called "legacy" by Telegram, still works | Current | Current, the standard OAuth 2.0 / OpenID Connect flow |
| **Setup in BotFather** | `/setdomain` | Turn on a Mini App | Switch the bot to OpenID Connect, copy two keys |

Pick by where your users are:

- **Your app runs inside Telegram** → **Mini App**. Sign-in is automatic.
- **Your app is a website and you want the quickest setup** → **Login Widget**. One bot, one command in BotFather.
- **Your app is a website and you want phone numbers, or a standard OAuth flow like "Sign in with Google"** → **OIDC**.

> **The two-bot rule.** A Telegram bot can serve the Login Widget *or* OIDC, never both. When you switch a bot to OpenID Connect in BotFather, Telegram permanently turns off that bot's Login Widget. So if you want both on your website, create two bots. A Mini App isn't affected by the switch (it shares the bot whose token you give the plugin as `botToken`). The plugin warns at startup if it sees the Login Widget and OIDC on one bot.

New words? The [glossary](docs/README.md#glossary) explains bots, BotFather, OIDC, Mini Apps and the rest in one line each.

## Requirements

- **Node.js 24 or newer** (Bun works too).
- **Better Auth 1.7.12 or newer, below 1.8**: `better-auth` and `@better-auth/core` `>=1.7.12 <1.8.0`. Better Auth 1.6 is not supported, because it has a critical security issue with no 1.6 fix ([details](docs/migration-v2-to-v3.md#why-upgrade)).
- **A Telegram account**, to create a bot.
- **A public HTTPS address** for your app. Telegram does not work with `localhost`. During development, a tunnel such as [ngrok](https://ngrok.com) gives your local server a public HTTPS address.

## Quick start (about 10 minutes)

This sets up the **Login Widget** on a Next.js app with a SQLite database. Other frameworks and databases work the same way; only steps 4 and 5 change (links are in each step). For OIDC or Mini Apps, follow this quick start up to step 7 (skip `/setdomain` in step 2), then see [The other sign-in methods](#the-other-sign-in-methods).

### 1. Start a tunnel

Telegram needs a public HTTPS address, so start one for your local server (port 3000 here):

```bash
ngrok http 3000
```

ngrok prints a URL like `https://abc123.ngrok-free.app`. Keep it open; you need it in the next steps.

### 2. Create a Telegram bot

1. In Telegram, open a chat with [@BotFather](https://t.me/botfather) and send `/newbot`.
2. BotFather asks for a **name** (shown to users, for example `My App Login`) and a **username** (must end in `bot`, for example `my_app_login_bot`).
3. BotFather replies with your **bot token**. It looks like `110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`. Treat it like a password.
4. Send `/setdomain`, pick your bot, and send your tunnel's domain without `https://`, for example `abc123.ngrok-free.app`.

More detail, with what you should see at each step: [Telegram bot setup](docs/telegram-bot-setup.md).

### 3. Install the packages

```bash
npm install better-auth-telegram better-auth
```

This installs v3 of the plugin. `@better-auth/core` comes with `better-auth`, so you don't install it separately.

Then add these to your `.env` file:

```bash
TELEGRAM_BOT_TOKEN="110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"   # from BotFather
TELEGRAM_BOT_USERNAME="my_app_login_bot"                            # without the @
BETTER_AUTH_SECRET="paste the output of: openssl rand -base64 32"
BETTER_AUTH_URL="https://abc123.ngrok-free.app"                     # your tunnel URL
```

`BETTER_AUTH_URL` must be the address you open in the browser. Better Auth only accepts sign-ins from that origin (and any you list in `trustedOrigins`).

### 4. Set up the server

Create `auth.ts`. This uses the SQLite database built into Node.js (`node:sqlite`), so there is nothing else to install. For PostgreSQL, MySQL, Prisma, Drizzle or MongoDB, change the `database` line as shown in [Better Auth's database docs](https://www.better-auth.com/docs/concepts/database).

```ts
// auth.ts
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: new DatabaseSync("./sqlite.db"),
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
    }),
  ],
});
```

### 5. Connect Better Auth to your framework

Better Auth answers requests under `/api/auth`. In Next.js (App Router), create this file:

```ts
// app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

Using something else? Better Auth has a page for [each framework](https://www.better-auth.com/docs/integrations/next) (Express, Hono, SvelteKit, Nuxt and more).

### 6. Create the database tables

```bash
npx auth@1.7.14 migrate
npx auth@1.7.14 check schema
```

The first command creates Better Auth's tables plus the plugin's Telegram columns. The second should print `Schema check passed against the live database.` Using Prisma or Drizzle? Run `npx auth@1.7.14 generate` instead of `migrate`, then your ORM's own migration ([details](docs/installation.md#3-update-your-database)).

> **Don't skip this step.** Better Auth refuses to answer any auth request (HTTP 500, "schema mismatch") until the database has every column it expects.

### 7. Set up the client

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  plugins: [telegramClient()],
});
```

Using React? Import `createAuthClient` from `better-auth/react` instead, and you get the `useSession()` hook.

### 8. Show the Telegram button

Put an empty element on your login page, for example `<div id="telegram-login"></div>`, then run this in the browser once the page has loaded:

```ts
// login.ts
import { authClient } from "./auth-client";

export async function showTelegramLogin() {
  const widget = await authClient.initTelegramWidget(
    "telegram-login",
    { size: "large" },
    async (telegramData) => {
      const { error } = await authClient.signInWithTelegram(telegramData);
      if (error) {
        console.error("Telegram sign-in failed:", error.message);
        return;
      }
      window.location.href = "/dashboard";
    }
  );
  return widget; // call widget.destroy() to remove the button
}
```

A React version, with cleanup on unmount, is in the [usage guide](docs/usage.md#react-component).

### 9. Try it

Open your tunnel URL (not `localhost`) and click the Telegram button. Telegram asks you to confirm, then your callback runs and you are signed in.

Look at the new user in your database. Their email is something like `8306595751@telegram.placeholder.invalid`. That is expected: Telegram never shares email addresses, but Better Auth requires one, so the plugin stores an address that can never receive mail. [Why placeholder emails exist](docs/installation.md#placeholder-emails).

Something not working? [Troubleshooting](docs/troubleshooting.md) is organized by what you see.

## The other sign-in methods

### Mini App

In `auth.ts` from the quick start, change the `telegram(...)` call to:

```ts
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  miniApp: { enabled: true },
});
```

Inside your Mini App, one call signs the user in:

```ts
import { authClient } from "./auth-client";

const { data, error } = await authClient.autoSignInFromMiniApp();
```

Full guide, including BotFather setup and cookies inside Telegram Web: [Mini Apps](docs/miniapps.md).

### OIDC

You need a bot switched to OpenID Connect, its **Client ID** and **Client Secret** from BotFather, and your callback URL registered there ([step by step](docs/telegram-bot-setup.md#oidc)). Then change the `telegram(...)` call in `auth.ts` to:

```ts
telegram({
  loginWidget: false, // or keep the widget on a second bot, see the two-bot rule
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
  },
});
```

and start sign-in from a button's click handler:

```ts
import { authClient } from "./auth-client";

await authClient.signInWithTelegramOIDC({ callbackURL: "/dashboard" });
```

Full guide, including phone numbers and limits: [OIDC](docs/oidc.md).

## What the plugin stores

When the Login Widget or Mini App is on (the Login Widget is on by default), the plugin adds five optional columns:

- `user.telegramId`, `user.telegramUsername`, `user.telegramPhoneNumber`
- `account.telegramId`, `account.telegramUsername`

An OIDC-only setup (`loginWidget: false`, no Mini App) adds no columns.

New users get a **placeholder email** unless you give them a real one: `<telegram id>@telegram.placeholder.invalid` (Login Widget and Mini App) or `<sub>@telegram-oidc.placeholder.invalid` (OIDC). These addresses are reserved for Telegram sign-in, and `emailVerified` stays `false`. More in [Installation](docs/installation.md#placeholder-emails).

## Documentation

| I want to... | Read |
|---|---|
| Find the right page, or look up a word | [Docs index and glossary](docs/README.md) |
| Set everything up step by step | [Installation](docs/installation.md) and [Telegram bot setup](docs/telegram-bot-setup.md) |
| Add the Login Widget, link and unlink accounts | [Usage](docs/usage.md) |
| Sign in with OIDC | [OIDC](docs/oidc.md) |
| Sign in inside a Mini App | [Mini Apps](docs/miniapps.md) |
| See every option | [Configuration](docs/configuration.md) |
| Understand what is checked, and the known limits | [Security](docs/security.md) |
| Fix an error | [Troubleshooting](docs/troubleshooting.md) |
| Look up an endpoint, type or error code | [API reference](docs/api-reference.md) |
| Upgrade from v2 | [Migration guide](docs/migration-v2-to-v3.md) |

Example code: [`examples/nextjs-app/`](examples/nextjs-app) has components for all three methods plus linking. [`test/`](test) is a complete Next.js playground app.

## Upgrading from v2

v3 supports Better Auth 1.7 and drops Better Auth 1.6. Upgrade because Better Auth below 1.7.7 has a critical account-takeover issue ([GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm)) that is not fixed in 1.6.

In short: upgrade Better Auth to 1.7.12 or newer, update your database schema, set `oidc.clientSecret` if you use OIDC, and check your unlink UI and database hooks. The [migration guide](docs/migration-v2-to-v3.md) walks through every step and every breaking change. Older upgrade notes (v0.x to v2) are in the [changelog](CHANGELOG.md).

## Links

- [Better Auth](https://www.better-auth.com)
- [Log In With Telegram (OIDC)](https://core.telegram.org/bots/telegram-login)
- [Telegram Login Widget (legacy)](https://core.telegram.org/widgets/login-legacy)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Changelog](CHANGELOG.md)
- [Report a bug](https://github.com/vcode-sh/better-auth-telegram/issues) · [Security issues](SECURITY.md)

## License

MIT. Created by [Vibe Code](https://x.com/vcode_sh).
