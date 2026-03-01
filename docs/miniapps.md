# Telegram Mini Apps

Your web app, living inside Telegram. No login popups, no OAuth dances, no "please verify your email." The user opened your Mini App — they're already Telegram. Act accordingly.

Works with `better-auth-telegram` v0.4.0+ and `better-auth@^1.5.0`.

## Mini Apps vs Login Widget

Before you commit to a path, know what you're choosing:

| | Login Widget | Mini Apps |
|---|---|---|
| **Where it runs** | Your website | Inside Telegram |
| **User action** | Click & authorize in popup | Automatic (they're already there) |
| **User data** | Name, photo, username | All that + language, premium status, chat context |
| **Start params** | Nope | Yes |
| **Setup effort** | Drop a widget | Register a Mini App with BotFather |

If your app lives on the open web, use the Login Widget. If your app lives inside Telegram, you're in the right doc.

## Setup

### 1. Create a Mini App with BotFather

You need a bot first. If you don't have one, `/newbot` in [@BotFather](https://t.me/botfather). Then:

1. Send `/newapp` to BotFather
2. Pick your bot
3. Provide a title, description, icon (512x512 PNG), your HTTPS web app URL, and a short name
4. You get a link: `t.me/yourbot/yourapp`

### 2. Local Dev (HTTPS Required)

Telegram demands HTTPS. For local dev, tunnel it:

```bash
npx ngrok http 3000
```

Update your Mini App URL in BotFather (`/myapps` -> Edit Web App URL) to the ngrok URL.

## Server Configuration

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your database */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,
      miniApp: {
        enabled: true,
      },
    }),
  ],
});
```

That's the minimum. Here's every knob you can turn:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "mybot",

  // Auto-create users on first sign-in (default: true)
  autoCreateUser: true,

  // Max age of auth_date in seconds, prevents replay attacks (default: 86400 = 24h)
  maxAuthAge: 86400,

  miniApp: {
    enabled: true,

    // Validate initData cryptographically (default: true)
    // Turn this off and you deserve what happens next
    validateInitData: true,

    // Allow auto-signin to create new users (default: true)
    // New users are created ONLY when BOTH autoCreateUser AND allowAutoSignin are true
    allowAutoSignin: true,

    // Map Telegram user data to your user model
    mapMiniAppDataToUser: (user) => ({
      name: user.username || user.first_name,
      image: user.photo_url,
    }),
  },
})
```

## Client Implementation

### 1. Load the Telegram WebApp SDK

Add this to your HTML `<head>`:

```html
<script src="https://telegram.org/js/telegram-web-app.js" async></script>
```

### 2. Create the Auth Client

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [telegramClient()],
});
```

### 3. Auto Sign-in (The Whole Point)

The simplest path. User opens your Mini App, you sign them in. No clicks, no forms, no existential friction:

```typescript
const result = await authClient.autoSignInFromMiniApp();
// result.data?.user — your user, authenticated, ready to go
```

`autoSignInFromMiniApp()` grabs `window.Telegram.WebApp.initData` automatically, sends it to `/telegram/miniapp/signin`, sets the session cookie, done. If it's not running inside Telegram, it throws.

### 4. Manual Sign-in (More Control)

If you want to validate first or handle the flow yourself:

```typescript
const initData = window.Telegram.WebApp.initData;

// Optional: validate without signing in
const validation = await authClient.validateMiniApp(initData);
if (!validation.data?.valid) {
  // something's off
}

// Sign in
const result = await authClient.signInWithMiniApp(initData);
```

### React Example

```tsx
import { useEffect, useState } from "react";
import { authClient } from "./auth-client";

function MiniApp() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    authClient.autoSignInFromMiniApp()
      .then((result) => setUser(result.data?.user))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div>Auth failed: {error}</div>;
  if (!user) return <div>Loading...</div>;
  return <div>Welcome, {user.name}</div>;
}
```

## API Reference

### Server Endpoints

Both only exist when `miniApp.enabled` is `true`.

#### `POST /api/auth/telegram/miniapp/signin`

Signs in (or creates) a user from Mini App initData. Sets session cookie.

**Body:** `{ "initData": "user=%7B%22id%22...&auth_date=...&hash=..." }`

**Returns:** `{ user, session }`

**Errors:**
- `400` — Missing or malformed initData, no user in payload
- `401` — Cryptographic verification failed
- `404` — User not found and auto-creation disabled (`autoCreateUser` or `allowAutoSignin` is `false`)

#### `POST /api/auth/telegram/miniapp/validate`

Validates initData without creating a session. Useful for checking if the data is legit before doing something with it.

**Body:** `{ "initData": "..." }`

**Returns:** `{ valid: boolean, data: TelegramMiniAppData | null }`

### Client Methods

| Method | What it does |
|---|---|
| `authClient.signInWithMiniApp(initData)` | Sign in with raw initData string |
| `authClient.validateMiniApp(initData)` | Validate initData, get parsed data back |
| `authClient.autoSignInFromMiniApp()` | Grab initData from `window.Telegram.WebApp` and sign in automatically |

### Types

```typescript
interface TelegramMiniAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  is_bot?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

interface TelegramMiniAppData {
  user?: TelegramMiniAppUser;
  receiver?: TelegramMiniAppUser;
  chat?: TelegramMiniAppChat;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  query_id?: string;
  auth_date: number;
  hash: string;
}

interface TelegramMiniAppChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  photo_url?: string;
}
```

## How Verification Works

Unlike the Login Widget (which uses `SHA256(botToken)` as the HMAC key), Mini Apps use a two-step HMAC:

1. `secret = HMAC-SHA256("WebAppData", botToken)`
2. `signature = HMAC-SHA256(secret, dataCheckString)`

Where `dataCheckString` is all initData params (minus `hash`), sorted alphabetically, joined with `\n`. Timestamp is checked against `maxAuthAge` (default 24h) to prevent replay attacks.

All of this runs on Web Crypto API (`crypto.subtle`) — no Node-specific deps, works everywhere.

## Troubleshooting

**"Not running in Telegram Mini App"** — You opened the page in a browser, not in Telegram. Open via `t.me/yourbot/yourapp`.

**"Telegram.WebApp is undefined"** — The SDK script hasn't loaded yet. Make sure `telegram-web-app.js` is in your `<head>`. If you're doing manual init, wait for it.

**"No initData available"** — The Mini App isn't properly configured in BotFather, or you're hitting the URL directly instead of through Telegram.

**"Invalid Mini App initData" (401)** — Cryptographic verification failed. Check your `TELEGRAM_BOT_TOKEN` is correct and matches the bot that owns the Mini App. Also check if `auth_date` is within `maxAuthAge`.

**"User not found and auto-signin is disabled" (404)** — Either `autoCreateUser` or `miniApp.allowAutoSignin` is `false`, and this Telegram user doesn't have an existing account. Both must be `true` to create new users via Mini App.

## Resources

- [Telegram Mini Apps Docs](https://core.telegram.org/bots/webapps)
- [Telegram WebApp API](https://core.telegram.org/bots/webapps#initializing-mini-apps)
- [Better Auth](https://better-auth.com)
- [GitHub](https://github.com/vcode-sh/better-auth-telegram)
