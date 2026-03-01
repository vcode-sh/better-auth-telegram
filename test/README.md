# Better Auth + Telegram Test App

Test/playground application for the `better-auth-telegram` plugin. Demonstrates all three authentication flows: Login Widget, Mini App, and OIDC.

## Quick Start

### 1. Set up Telegram Bot

1. Open Telegram and find [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the instructions
3. Save the **Bot Token** (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. Save the **Bot Username** (format: `your_bot_username`)

### 2. Configure the project

```bash
cd test
npm install

# Copy and edit environment files
cp .env.local.example .env.local
```

Edit `.env.local` with your bot credentials:
```env
TELEGRAM_BOT_TOKEN="your_bot_token_here"
TELEGRAM_BOT_USERNAME="your_bot_username_here"
```

> **Note:** Prisma CLI reads from `.env`, not `.env.local`. Create a `.env` file too:
> ```bash
> echo 'DATABASE_URL="file:./prisma/dev.db"' > .env
> ```

### 3. Set up the database

```bash
npx prisma db push
```

### 4. Set the bot domain

Send `/setdomain` to @BotFather and set it based on your setup:

| Setup | Domain to set | Auth flows supported |
|-------|--------------|---------------------|
| localhost only | `localhost` | Login Widget |
| ngrok (recommended) | `your-subdomain.ngrok-free.app` | Login Widget + OIDC |

### 5. Run the app

**Option A: localhost only** (Login Widget only)
```bash
npm run dev
# Open http://localhost:3000
```

**Option B: With ngrok** (all auth flows including OIDC)

OIDC requires a publicly accessible HTTPS URL because Telegram's OAuth server needs to redirect back to your app. [ngrok](https://ngrok.com/) tunnels your localhost to a public URL.

```bash
# Terminal 1: Start ngrok
ngrok http 3000

# Copy the https://xxxx.ngrok-free.app URL, then update .env.local:
# BETTER_AUTH_URL="https://xxxx.ngrok-free.app"
# BETTER_AUTH_TRUSTED_ORIGINS="https://xxxx.ngrok-free.app"
# NEXT_PUBLIC_APP_URL="https://xxxx.ngrok-free.app"

# Terminal 2: Start the app
npm run dev

# Open your ngrok URL in the browser
```

> **Important:** After starting ngrok, update the BotFather `/setdomain` to your ngrok domain.
> Free ngrok URLs change on restart — you'll need to update `.env.local` and BotFather each time.

## Auth Flows

### Login Widget
Sign in via the embedded Telegram button on the home page. Uses HMAC-SHA-256 verification of the widget data.

### Mini App
Auto-authentication inside Telegram Mini Apps. To test:
1. Create a Mini App via @BotFather using `/newapp`
2. Set the Web App URL to `[your-url]/miniapp`
3. Open the bot in Telegram and launch the Mini App

### OIDC
OAuth 2.0 Authorization Code flow with PKCE via `oauth.telegram.org`. Navigate to `/oidc` and click the button. **Requires ngrok** (or any public HTTPS URL).

## Project Structure

```
test/
├── app/
│   ├── api/auth/[...all]/    # Better Auth API routes
│   ├── dashboard/             # Protected dashboard
│   ├── miniapp/               # Mini App test page
│   ├── oidc/                  # OIDC test page
│   └── page.tsx               # Home page with login
├── components/
│   ├── TelegramLoginButton.tsx  # Login widget component
│   └── SessionDisplay.tsx       # Session info display
├── lib/
│   ├── auth.ts                # Server-side auth config
│   └── auth-client.ts         # Client-side auth
├── prisma/
│   └── schema.prisma          # Database schema
└── .env.local.example         # Environment variables template
```

## Manual Testing

### Test 1: Login Widget

1. Open your app URL
2. Click "Login with Telegram"
3. Authenticate in Telegram
4. Verify redirect to `/dashboard`
5. Check user data display (username, photo, Telegram ID)

### Test 2: Session persistence

1. Refresh the page — should stay logged in
2. Open in a new tab — should have session
3. Close and reopen browser — session should persist (7 day expiry)

### Test 3: Sign out

1. On the dashboard click "Sign Out"
2. Verify redirect to home
3. Try accessing `/dashboard` — should show "No active session"

### Test 4: Mini App

1. Create a Mini App via @BotFather using `/newapp`
2. Set the Web App URL to your app's `/miniapp` path
3. Open the bot in Telegram and launch the Mini App
4. Auto-authentication should happen and redirect to dashboard

### Test 5: OIDC

1. Start ngrok and update `.env.local` + BotFather domain
2. Navigate to `/oidc`
3. Click "Sign in with Telegram OIDC"
4. Authorize on Telegram's OAuth page
5. Verify redirect to dashboard with session

### Test 6: API Endpoints

```bash
# Get Telegram config
curl http://localhost:3000/api/auth/telegram/config
# Expected: {"botUsername":"your_bot_username","testMode":false}
```

## Troubleshooting

### "Bot domain invalid"

1. Check that you set `/setdomain` in @BotFather to match your current URL
2. For localhost use exactly: `localhost` (no http://)
3. For ngrok: set the full ngrok subdomain (e.g. `xxxx.ngrok-free.app`)
4. The Login Widget may not work on desktop with ngrok free tier — try mobile

### "origin required" (OIDC)

Make sure you're using `better-auth-telegram` v1.2.1+ which includes the `origin` parameter fix.

### "Telegram widget not loading"

1. Check browser console for errors
2. Verify the bot domain matches your current URL
3. Try clearing browser cache

### "Invalid Telegram authentication"

1. Verify `TELEGRAM_BOT_TOKEN` in `.env.local` is correct
2. Verify `TELEGRAM_BOT_USERNAME` is without `@`
3. Check that auth_date is not too old (max 24h)

### "Database error"

```bash
# Delete the database and let Prisma recreate it
rm prisma/dev.db
npx prisma db push
npm run dev
```

### Prisma can't find DATABASE_URL

Prisma CLI reads `.env`, not `.env.local`. Create a separate `.env` file:
```bash
echo 'DATABASE_URL="file:./prisma/dev.db"' > .env
```

## Tech Stack

- [Next.js](https://nextjs.org/) 16 with Turbopack
- [Better Auth](https://better-auth.com) with Prisma adapter
- [better-auth-telegram](https://www.npmjs.com/package/better-auth-telegram) plugin
- [Prisma](https://www.prisma.io/) with SQLite
- [Tailwind CSS](https://tailwindcss.com/) v4

## Links

- [Better Auth Docs](https://better-auth.com)
- [Telegram Login Widget Docs](https://core.telegram.org/widgets/login)
- [Telegram Mini Apps Docs](https://core.telegram.org/bots/webapps)
- [Telegram OIDC Docs](https://core.telegram.org/bots/features#telegram-login-widget-oidc)
- [Plugin Source Code](..)

## License

MIT
