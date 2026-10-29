# Telegram sign-in playground

This small Next.js app lets you try the Login Widget, Mini App and OIDC against the local plugin. It uses Prisma with SQLite. Use throwaway bots and test accounts; this app is for development.

## Set it up

From the repository root:

```bash
npm ci
npm run build
cd test
npm install
cp .env.local.example .env.local
```

Edit `.env.local`: set `BETTER_AUTH_SECRET`, your public `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, trusted origins, and the bot credentials. Follow the main [bot setup guide](../docs/telegram-bot-setup.md) for each method you enable.

The default configuration enables all three methods. That requires two bots: one for the Login Widget and Mini App (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`), and a separate OIDC bot (`TELEGRAM_OIDC_CLIENT_ID`, `TELEGRAM_OIDC_CLIENT_SECRET`). Switching a bot to OIDC permanently disables its legacy Login Widget. To try fewer methods, change `lib/auth.ts` first.

Prisma's CLI reads `.env`, while Next.js reads `.env.local`. Create `.env` with only the database setting, matching `.env.local`:

```dotenv
DATABASE_URL="file:./dev.db"
```

Generate the Prisma client and prepare this disposable development database:

```bash
npm run db:generate
npm run db:push
npm run dev
```

`db:push` is for this playground. Use reviewed migrations for a real app. Do not delete a database to resolve a schema error; see the [installation guide](../docs/installation.md#3-update-your-database).

## Give Telegram a public address

A tunnel forwards a public HTTPS address to local port 3000. Keep it running alongside the dev server. Set the same address in `.env.local`, restart the server after changing it, then open that public address in your browser.

- Login Widget: register the public domain with `/setdomain` on the widget bot.
- Mini App: configure its HTTPS launch URL as `https://<your domain>/miniapp` in BotFather.
- OIDC: register `https://<your domain>/api/auth/callback/telegram-oidc` under the OIDC bot's **Redirect URIs**. `/setdomain` does not configure OIDC.

If a tunnel gives you a new address, update both the environment and the relevant BotFather settings. `localhost` is not the Telegram callback address.

## Try the flows

1. Open `/widget`, click the Telegram button and confirm. You should reach `/dashboard` with a session and Telegram details.
2. Refresh `/dashboard` to check session persistence, then sign out and confirm the dashboard is no longer authenticated.
3. Open the Mini App from Telegram. It should sign in automatically and reach `/dashboard`; opening `/miniapp` in an ordinary browser does not supply Telegram `initData`.
4. Open `/oidc`, start sign-in and confirm in Telegram. You should return to `/dashboard`. Declining the Telegram prompt may leave you on Telegram's account picker without a callback.
5. Check `GET /api/auth/telegram/config`: it should show the configured methods and bot username, with no bot token or client secret.

For each enabled method, try both a new Telegram account and an existing one. The [automated tests](../CONTRIBUTING.md) cover rejection cases, hooks, account linking and database adapters; this playground is for observing real Telegram behavior.

## If something fails

Use the main [troubleshooting guide](../docs/troubleshooting.md), which groups fixes by symptom and error code. Check the server logs and the browser's Network tab before changing settings. For an OIDC redirect mismatch, compare the entire URI, including its scheme and callback path.

Official references: [legacy Login Widget](https://core.telegram.org/widgets/login-legacy), [Mini Apps](https://core.telegram.org/bots/webapps), [OIDC](https://core.telegram.org/bots/telegram-login), [Better Auth with Next.js](https://www.better-auth.com/docs/integrations/next).
