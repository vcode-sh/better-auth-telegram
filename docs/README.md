# better-auth-telegram

Telegram auth for [Better Auth](https://www.better-auth.com/). Login Widget, Mini Apps, the whole circus -- in one plugin that somehow works on every runtime.

v1.1.0 | 173 tests | ESM + CJS | Web Crypto API | Works where `node:crypto` fears to tread

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Docs](#docs)
- [Requirements](#requirements)
- [Links](#links)

---

## Quick Start

```bash
npm install better-auth-telegram
```

Message [@BotFather](https://t.me/botfather), run `/newbot`, pretend you had a plan all along.

**Server:**

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your database config */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: "your_bot_username",
    }),
  ],
});
```

**Client:**

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  plugins: [telegramClient()],
});
```

That's it. The rest is in the [Installation Guide](./installation.md) for people who read manuals.

---

## Features

- **Login Widget** -- callback and redirect modes, because one way to authenticate was never enough
- **OIDC (OpenID Connect)** -- standard OAuth 2.0 with PKCE via `oauth.telegram.org`. Phone numbers, RS256 JWTs, grown-up auth. Telegram finally joined the federation
- **Mini Apps** -- auto-signin, manual signin, initData validation. Enable it, forget it works
- **Link/unlink** -- attach Telegram to existing accounts, detach when you inevitably change your mind
- **HMAC-SHA-256 via Web Crypto API** (`crypto.subtle`) -- runs on Node, Bun, Cloudflare Workers, edge runtimes, presumably a toaster
- **Replay attack prevention** -- configurable `maxAuthAge` (default 24h) so yesterday's auth stays yesterday
- **Per-endpoint rate limiting** -- built into the plugin, not bolted on as an afterthought
- **`APIError` from `better-auth/api`** on all endpoints -- consistent, catchable, debuggable
- **Exported `$ERROR_CODES`** -- match errors client-side like a civilised person
- **`fetchOptions`** on all client methods -- custom headers, cache control, whatever you need
- **Async verification** -- `verifyTelegramAuth()` and `verifyMiniAppInitData()` return `Promise<boolean>`
- **Schema fields are `input: false`** -- `telegramId` and `telegramUsername` on user table can't be written to directly. Trust issues, but the good kind
- **`TelegramAccountRecord` type exported** -- for when you need to type things properly
- **ESM-first** (`"type": "module"`), CJS via `.cjs` because backwards compatibility is a lifestyle
- Full TypeScript. Framework-agnostic. Works with every Better Auth adapter

---

## Docs

- **[Installation Guide](./installation.md)** -- bot creation, server/client config, database schema, local dev with ngrok
- **[Usage Guide](./usage.md)** -- sign-in flows, account linking, session management, framework examples
- **[Mini Apps Guide](./miniapps.md)** -- Mini App auth, auto-signin, bot setup, testing, troubleshooting
- **[API Reference](./api-reference.md)** -- endpoints, types, schema extensions, configuration options
- **[Configuration Guide](./configuration.md)** -- server/client setup, env vars, widget customisation, user data mapping
- **[Security Best Practices](./security.md)** -- HMAC verification, token security, replay prevention, the full paranoia stack
- **[Troubleshooting](./troubleshooting.md)** -- widget issues, auth errors, session problems, the usual suspects

---

## Requirements

- Node.js >= 22 (or Bun, or any runtime with Web Crypto API)
- `better-auth@^1.5.0`
- HTTPS (Telegram insists, and honestly, so should you)
- Public domain (use ngrok for local dev)

---

## Links

- [GitHub](https://github.com/vcode-sh/better-auth-telegram)
- [npm](https://www.npmjs.com/package/better-auth-telegram)
- [Changelog](../CHANGELOG.md)
- [Better Auth](https://www.better-auth.com/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Login Widget](https://core.telegram.org/widgets/login)
- [Telegram OIDC](https://core.telegram.org/bots/features#oidc-authorization)

---

MIT | [Vibe Code](https://vcode.sh) | [@vcode_sh](https://x.com/vcode_sh)
