# Telegram Mini Apps

Your web app, living inside Telegram. No login popups, no OAuth dances, no "please verify your email." The user opened your Mini App — they're already Telegram. Act accordingly.

Requires `better-auth` and `@better-auth/core` `>=1.7.12 <1.8.0`, and the plugin's five Telegram columns in your database (see [Database Schema](./installation.md#database-schema)) -- Better Auth >= 1.7.3 answers every request with a 500 until they exist.

Mini Apps don't care whether your bot was switched to OpenID Connect in BotFather; that only kills the legacy Login Widget.

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
    // Turn this off and anyone can sign in as any Telegram user.
    // The plugin logs a startup warning, and you deserve what happens next
    validateInitData: true,

    // Allow auto-signin to create new users (default: true)
    // New users are created ONLY when BOTH autoCreateUser AND allowAutoSignin are true
    allowAutoSignin: true,

    // Map Telegram user data to your user model.
    // Merged over the defaults (first + last name, photo_url, placeholder email)
    mapMiniAppDataToUser: (user) => ({
      name: user.username || user.first_name,
    }),
  },
})
```

## Client Implementation

### 1. Load the Telegram WebApp SDK

Add this to your HTML `<head>`, before your other scripts, and without `async` ([Telegram's instructions](https://core.telegram.org/bots/webapps)):

```html
<script src="https://telegram.org/js/telegram-web-app.js?64"></script>
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

`autoSignInFromMiniApp()` prefers `window.Telegram.WebApp.initData` and falls back to the `tgWebAppData` launch parameter in `window.location.hash`. It sends the raw value to `/telegram/miniapp/signin`, where the server verifies it before creating a session. If neither source exists, it throws.

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

Signs in (or creates) a user from Mini App initData. Sets session cookie. Finds an existing user by the Telegram account first, then by `user.telegramId` -- so a user who signed in with the Login Widget, or signed up with OIDC (when the plugin copied their Telegram id), lands in the same account. Writes go through Better Auth's internal adapter (in a transaction): `databaseHooks` run, and `user.validateUserInfo` sees `source.method: "telegram-mini-app"` with action `"sign-in"` (returning user), `"link-account"` (linked by `telegramId`) or `"create-user"`. New users get the placeholder email `<telegramId>@telegram.placeholder.invalid` unless your mapper returns one. If the user unlinked their Telegram account, the `telegramId` lookup no longer finds them: removing a Telegram account clears `user.telegramId` unless another Telegram account still proves it. With Better Auth's `account.accountLinking.enabled: false` or `disableImplicitLinking: true`, the `telegramId` lookup doesn't link and answers 401 `ACCOUNT_NOT_LINKED`. Browser requests from an origin outside `trustedOrigins` get 403 `INVALID_ORIGIN` (login CSRF protection), so a Mini App served from another origin than the auth server needs that origin in `trustedOrigins`. The signed-in user is always `user`, never the chat partner in `receiver`.

**Body:** `{ "initData": "user=%7B%22id%22...&auth_date=...&hash=..." }`

**Returns:** `{ user, session }`

**Errors:**
- `400` — Missing or malformed initData, no user in payload
- `401` — Cryptographic verification failed, or `auth_date` older than `maxAuthAge` / more than 60 s in the future
- `403` — `user.validateUserInfo` rejected the sign-in, link or sign-up (`validation_failed` if it threw), or a database hook vetoed creating the user (`USER_CREATION_REJECTED`)
- `404` — User not found and auto-creation disabled (`autoCreateUser` or `allowAutoSignin` is `false`)
- `500` — `botToken` not configured (`BOT_TOKEN_REQUIRED`), or the database schema doesn't match

#### `POST /api/auth/telegram/miniapp/validate`

Validates initData without creating a session. Useful for checking if the data is legit before doing something with it. Always verifies the HMAC, whatever `validateInitData` says.

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
  added_to_attachment_menu?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

interface TelegramMiniAppData {
  user?: TelegramMiniAppUser;
  receiver?: TelegramMiniAppUser;
  chat?: TelegramMiniAppChat;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  chat_instance?: string;
  chat_join_request_query_id?: string; // opened from a chat join request
  start_param?: string;
  can_send_after?: number;
  query_id?: string;
  auth_date: number;
  signature?: string; // Ed25519, for third-party validation
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

Where `dataCheckString` is all initData params (minus `hash`, but including `signature`, as Telegram specifies), sorted alphabetically, joined with `\n`. The `hash` must be 64 lowercase hex characters and is compared in constant time. `auth_date` must be an integer no older than `maxAuthAge` (default 24h) and no more than 60 seconds in the future.

The Ed25519 `signature` field exists so third parties can validate initData without your bot token. The plugin has the bot token, so it doesn't implement that check; the HMAC already covers `signature`.

All of this runs on Web Crypto API (`crypto.subtle`) — no Node-specific deps, works everywhere.

## Inside Telegram Web and Desktop (iframes and cookies)

Telegram's web clients open Mini Apps in an iframe: "web MTProto clients that need to open a game, open a bot mini app or process a payment in an iframe can use the postMessage API" ([Web events](https://core.telegram.org/api/web-events)). Inside that iframe your site is a third party, and the session cookie Better Auth sets is `SameSite=Lax` by default, which browsers don't send on cross-site subrequests. Safari's ITP blocks third-party cookies outright ([Better Auth: Safari, ITP, and cross-domain setups](https://better-auth.com/docs/concepts/cookies#safari-itp-and-cross-domain-setups)). The likely symptom: `autoSignInFromMiniApp()` answers 200, and the next `getSession()` is signed out. This hasn't been verified live in web.telegram.org yet.

What applies:

- **Cookie attributes** — Better Auth's `advanced.defaultCookieAttributes` sets attributes for all its cookies ([Options](https://better-auth.com/docs/reference/options)). A cookie that works in a cross-site iframe needs `sameSite: "none"` and `secure: true`; `partitioned: true` (CHIPS) keeps it scoped to the Telegram top-level site, which is what browsers that partition third-party cookies allow. `SameSite=None` gives up the browser's own CSRF defence, so keep `trustedOrigins` tight (Better Auth then checks the `Origin` of every cookie-carrying POST, and the plugin's sign-ins check it even without cookies).

  ```typescript
  betterAuth({
    advanced: {
      defaultCookieAttributes: { sameSite: "none", secure: true, partitioned: true },
    },
  });
  ```

- **The `bearer()` plugin** — sign-in responses then carry the session token in a `set-auth-token` header, which the client stores and sends as `Authorization: Bearer …` instead of a cookie ([Bearer plugin](https://better-auth.com/docs/plugins/bearer)). It works with `/telegram/miniapp/signin` like with Better Auth's own sign-ins. Better Auth warns to use it cautiously: a token in JavaScript-readable storage is exposed to XSS.
- **`crossSubDomainCookies`** — shares cookies across subdomains of one parent domain (`app.example.com` and `api.example.com`; [Cookies](https://better-auth.com/docs/concepts/cookies#cross-subdomain-cookies)). It helps when the Mini App and the auth server are on different subdomains, but it does not make the Telegram Web iframe first-party.

## Troubleshooting

**"Not running in Telegram Mini App"** — You opened the page in a browser, not in Telegram. Open via `t.me/yourbot/yourapp`.

**"Telegram.WebApp is undefined"** — The SDK script hasn't loaded yet. Make sure `telegram-web-app.js` is in your `<head>`. If you're doing manual init, wait for it.

**"No initData available"** — The Mini App isn't properly configured in BotFather, or you're hitting the URL directly instead of through Telegram.

**"Invalid Mini App initData" (401)** — Cryptographic verification failed. Check your `TELEGRAM_BOT_TOKEN` is correct and matches the bot that owns the Mini App. Also check if `auth_date` is within `maxAuthAge`, and that your server clock isn't more than a minute behind.

**500 with "Database schema mismatch"** — The Telegram columns are missing. Run `npx auth@latest generate` or `npx auth@latest migrate`, then `npx auth@latest check schema`.

**"User not found and auto-signin is disabled" (404)** — Either `autoCreateUser` or `miniApp.allowAutoSignin` is `false`, and this Telegram user doesn't have an existing account. Both must be `true` to create new users via Mini App.

## Resources

- [Telegram Mini Apps Docs](https://core.telegram.org/bots/webapps)
- [Telegram WebApp API](https://core.telegram.org/bots/webapps#initializing-mini-apps)
- [Better Auth](https://better-auth.com)
- [GitHub](https://github.com/vcode-sh/better-auth-telegram)
