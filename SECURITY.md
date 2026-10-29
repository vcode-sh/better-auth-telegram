# Security Policy

## Supported Versions

I only patch what's current. If you're running something older, you're on your own and I wish you well.

| Version | Supported          |
|---------|--------------------|
| 3.x     | Yes                |
| < 3.0   | No (2.x needs a Better Auth with GHSA-965c-763c-88jm) |

## Found a Vulnerability?

First of all, thank you. Second of all, please do not open a public GitHub issue. I know the temptation to post "CRITICAL SECURITY FLAW" in big letters is strong, but broadcasting a vulnerability before it's patched is the infosec equivalent of leaving your front door open and tweeting your address.

**Email hello@vcode.sh** with:

- What the vulnerability is (be specific -- "something feels off" is not actionable)
- Steps to reproduce it
- The potential impact (how bad could this get?)
- A suggested fix, if you have one (I'm not proud)

I'll acknowledge your report within 48 hours. Critical issues get patched within 7 days. I'll credit you in the release notes unless you'd prefer to remain a mysterious security benefactor.

## What I've Already Thought About

This plugin was built by someone who's read enough CVEs to develop a nervous twitch. Here's what's baked in:

- **HMAC-SHA-256 via Web Crypto API** -- all verification runs through `crypto.subtle`, no synchronous fallbacks, no `node:crypto` imports. Works everywhere, trusts nothing
- **Bounded replay window** -- `auth_date` must be younger than `maxAuthAge` (default 24h) and at most 60 s in the future. Inside that window signed data can be replayed; lower `maxAuthAge` if that matters to you
- **Different secret derivation paths** -- Login Widget uses `SHA256(botToken)`, Mini Apps use `HMAC-SHA256("WebAppData", botToken)`. Two doors, two keys
- **Bot token stays server-side** -- never exposed to the client, never in responses, never in error messages. It's a secret, not a talking point
- **Per-endpoint rate limiting** -- signin, link, unlink, validate -- all throttled when Better Auth's rate limiter is on (by default only in production)
- **Input validation** -- all endpoints validate data shape before touching crypto. Garbage in, `400 BAD_REQUEST` out
- **`input: false` on user schema fields** -- `telegramId` and `telegramUsername` can't be written to directly during signup. No creative users setting their own Telegram ID
- **`APIError` throws** -- consistent error handling through Better Auth's pipeline. No raw JSON leaking internal state
