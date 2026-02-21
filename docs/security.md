# Security

Because "trust me bro" is not a cryptographic primitive.

## Table of Contents

- [Overview](#overview)
- [HMAC Verification](#hmac-verification)
- [Replay Attack Prevention](#replay-attack-prevention)
- [Rate Limiting](#rate-limiting)
- [Token Security](#token-security)
- [Session Security](#session-security)
- [Schema Security](#schema-security)
- [Security Checklist](#security-checklist)
- [Reporting Vulnerabilities](#reporting-vulnerabilities)

## Overview

The plugin implements several layers of security so you can sleep at night instead of refreshing your error dashboard:

1. **HMAC-SHA-256 Verification** — cryptographic proof that Telegram sent the data, not some bloke with curl
2. **Timestamp Validation** — stops replay attacks dead. Old data gets rejected, no exceptions
3. **Built-in Rate Limiting** — every endpoint is rate-limited out of the box
4. **Schema Protection** — `telegramId` and `telegramUsername` on the user table have `input: false`, so clients cannot write to them directly
5. **Account Uniqueness** — one Telegram account, one user. No double-dipping

## HMAC Verification

### How It Works

Every authentication payload from Telegram includes an HMAC-SHA-256 hash. The plugin verifies it using the **Web Crypto API** (`crypto.subtle`) — no Node.js `crypto` module, works everywhere (Node, Deno, Cloudflare Workers, edge runtimes, your toaster if it runs V8).

**Login Widget verification:**

1. Extract `hash` from the auth data
2. Sort remaining fields alphabetically, join as `key=value\n` pairs
3. Derive secret: `SHA-256(botToken)`
4. Compute `HMAC-SHA-256(secret, dataCheckString)`
5. Compare computed hash with received hash

```typescript
// Simplified view of what the plugin does internally (Web Crypto API)
const secretKey = new Uint8Array(
  await crypto.subtle.digest("SHA-256", encoder.encode(botToken))
);

const cryptoKey = await crypto.subtle.importKey(
  "raw", secretKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
);

const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(dataCheckString));
```

**Mini App verification** uses a different key derivation:

1. Secret: `HMAC-SHA-256("WebAppData", botToken)` — note the literal string `"WebAppData"` as the HMAC key
2. Then: `HMAC-SHA-256(secret, sortedInitDataParams)`

Two paths, same idea: if the hash doesn't match, the request dies.

### What This Prevents

- **Data tampering** — modify a single byte and the HMAC fails
- **Source spoofing** — only someone with your bot token can produce a valid hash
- **Token exposure** — the bot token never leaves the server

## Replay Attack Prevention

Someone intercepts a valid auth payload and sends it again three days later. Classic.

The plugin checks `auth_date` against the current time. If the data is older than `maxAuthAge`, it gets rejected.

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "your_bot",
  maxAuthAge: 86400, // 24 hours (default)
})
```

The default is `86400` seconds (24 hours). Tighten it if you're paranoid, loosen it if you trust humanity (don't):

| Use Case | Value | Notes |
|----------|-------|-------|
| High security | `3600` (1 hour) | Banking, sensitive data |
| Standard | `86400` (24 hours) | Default — sensible for most apps |
| Relaxed | `259200` (3 days) | Social apps, lower risk |

Both Login Widget and Mini App verification paths enforce this timestamp check.

## Rate Limiting

The plugin ships with **built-in rate limiting** on every endpoint. You don't need to configure anything, install Redis, or write a custom middleware that you'll definitely get wrong the first time.

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/telegram/signin` | 10 requests | 60 seconds |
| `/telegram/link` | 5 requests | 60 seconds |
| `/telegram/unlink` | 5 requests | 60 seconds |
| `/telegram/miniapp/signin` | 10 requests | 60 seconds |
| `/telegram/miniapp/validate` | 20 requests | 60 seconds |

These limits are enforced via Better Auth's built-in rate limiting system. Link and unlink are tighter because they're more sensitive operations.

If you need stricter limits or distributed rate limiting (multiple server instances), you can layer on additional protection at the infrastructure level — your reverse proxy, CDN, or framework middleware. But the defaults will keep the script kiddies at bay.

## Token Security

Your bot token is the key to the castle. If it leaks, someone can impersonate your bot, read messages, and generally ruin your week.

**Environment variables. Always.**

```typescript
// No
telegram({
  botToken: "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
  botUsername: "my_bot",
})

// Yes
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
})
```

**Keep it out of git:**

```gitignore
.env
.env.local
.env.*.local
```

**Use separate bots for dev and production.** Your test bot should not have access to production data, and your production bot should not be running on `localhost:3000` via ngrok.

**Rotate tokens** periodically via @BotFather. Update your environment, deploy, revoke the old one.

## Session Security

Session management is Better Auth's domain, not this plugin's. But since you're here, the basics:

```typescript
export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!, // Generate with: openssl rand -hex 32
  advanced: {
    useSecureCookies: true,     // HTTPS only in production
    cookieSameSite: "lax",      // CSRF protection
  },
});
```

Generate a proper secret. `"password123"` is not a secret, it's a cry for help.

```bash
openssl rand -hex 32
```

## Schema Security

The user table fields `telegramId` and `telegramUsername` are defined with `input: false`. This means clients cannot set or modify these values through Better Auth's API — they're server-side only, populated during authentication.

The account table stores the provider link with `providerId: "telegram"` and enforces that a Telegram account cannot be linked to multiple users. Attempting to link an already-claimed Telegram account returns a `409 Conflict`.

## Security Checklist

Before shipping to production — the abridged "please don't get hacked" list:

- [ ] Bot token in environment variables, not hardcoded
- [ ] `.env` files in `.gitignore`
- [ ] Strong `BETTER_AUTH_SECRET` (use `openssl rand -hex 32`)
- [ ] HTTPS enabled (Telegram requires it for the Login Widget anyway)
- [ ] Domain configured with @BotFather (`/setdomain`)
- [ ] `maxAuthAge` set appropriately for your risk profile
- [ ] Secure cookies enabled in production
- [ ] Separate bots for development and production
- [ ] Error logging enabled (without logging tokens or hashes, obviously)

## Reporting Vulnerabilities

Found something? Responsible disclosure, please.

1. **Do not** open a public GitHub issue
2. Email: [hello@vcode.sh](mailto:hello@vcode.sh)
3. Include: description, reproduction steps, potential impact
4. Allow time for a fix before public disclosure

We take security seriously. We take sarcasm more seriously, but security is a close second.
