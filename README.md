# Better-Auth Telegram Plugin

[![npm version](https://img.shields.io/npm/v/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![npm downloads](https://img.shields.io/npm/dm/better-auth-telegram)](https://www.npmjs.com/package/better-auth-telegram)
[![CI](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml/badge.svg)](https://github.com/vcode-sh/better-auth-telegram/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/vcode-sh/better-auth-telegram/branch/main/graph/badge.svg)](https://codecov.io/gh/vcode-sh/better-auth-telegram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)

Telegram authentication plugin for [Better Auth](https://better-auth.com).

## A word from the author

Better Auth saved my ass. Repeatedly. Like an embarrassing number of times.

When your auth library becomes your life support, you either say thank you or you build something back. I built a Telegram plugin. Nobody asked for it. Some people need it. That's close enough.

First npm package. Shipped it scared. 110 tests. 100% coverage. Obsessive? Maybe. But if I'm going down, I'm going down with green checkmarks.

Knowledge optional. Vibes mandatory. TypeScript reluctantly involved.

If it breaks, roast me on [X (@vcode_sh)](https://x.com/vcode_sh). If it works, also roast me. I'm there either way, posting through the pain.

Now go authenticate some Telegram users. Or don't. I'm a README, not a cop.

— [Vibe Code](https://x.com/vcode_sh)

## Features

- 🔐 Sign in with Telegram Login Widget (the button that actually works)
- 📱 **NEW:** Telegram Mini Apps support (because why not make it more complicated)
- 🔗 Link/unlink Telegram accounts to existing users (flexibility is key, or so they say)
- ✅ HMAC-SHA-256 verification (security theatre, but the good kind)
- 🎨 Customizable login widget (make it pretty, or don't)
- 📦 Full TypeScript support (types everywhere. sleep nowhere.)
- 🚀 Framework-agnostic (works with React, Vue, Svelte, vanilla JS, or whatever's trendy this week)
- 🔄 Supports both callback and redirect flows (because OAuth has trust issues)
- ⚡ Auto-signin for Mini Apps (one less click. revolutionary.)

## Installation

```bash
npm install better-auth-telegram
# or
pnpm add better-auth-telegram
# or
yarn add better-auth-telegram
```

Pick your poison. They all install the same package.

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram (yes, you talk to a bot to create a bot)
2. Send `/newbot` and follow the instructions (it's like naming a child, but less permanent)
3. Save the bot token (lose it and you start over. no pressure.)
4. Send `/setdomain` to @BotFather and provide your website domain

**Note:** For local development, you'll need a tunneling service like [ngrok](https://ngrok.com) because Telegram demands HTTPS and a public domain. Localhost? Never heard of it.

### 2. Configure Better Auth

**Server-side (`auth.ts`):**

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your database config */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: "your_bot_username", // without @
    }),
  ],
});
```

**Client-side (`auth-client.ts`):**

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL,
  fetchOptions: {
    credentials: "include", // Required for session cookies (linking, unlinking)
  },
  plugins: [telegramClient()],
});
```

**Important:** The `credentials: "include"` is required for session-based operations like linking and unlinking Telegram accounts. Without it, you'll get "Not authenticated" errors.

### 3. Database Setup

The plugin extends Better Auth's schema with Telegram-specific fields. Because of course it does.

If using Prisma, add these fields to your schema:

```prisma
model User {
  // ... other Better Auth fields
  telegramId       String?
  telegramUsername String?
}

model Account {
  // ... other Better Auth fields
  telegramId       String?
  telegramUsername String?
}
```

Then run migrations and pray nothing breaks:

```bash
npx prisma migrate dev
```

## Usage

### Sign In with Telegram

**React/Next.js example** (because everyone uses Next.js now, apparently):

```tsx
"use client";

import { authClient } from "./auth-client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function TelegramLoginButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authClient.initTelegramWidget(
      "telegram-login-container",
      {
        size: "large",
        showUserPhoto: true,
        cornerRadius: 20,
      },
      async (authData) => {
        const result = await authClient.signInWithTelegram(authData);
        if (result.error) {
          setError(result.error.message);
        } else {
          router.push("/dashboard");
        }
      }
    );
  }, [router]);

  return (
    <div>
      <div id="telegram-login-container"></div>
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
```

**Vanilla JavaScript** (for the purists):\*\*

```javascript
authClient.initTelegramWidget(
  "telegram-login-container",
  { size: "medium" },
  async (authData) => {
    const result = await authClient.signInWithTelegram(authData);
    console.log("User:", result.user);
  }
);
```

No framework. No build step. Just vibes.

### Link Telegram to Existing Account

```typescript
// User must be authenticated
authClient.initTelegramWidget(
  "telegram-link-container",
  { size: "small" },
  async (authData) => {
    try {
      await authClient.linkTelegram(authData);
      console.log("Telegram account linked!");
    } catch (error) {
      console.error("Failed to link:", error);
    }
  }
);
```

**Getting "Not authenticated" errors?** Make sure your auth client has `credentials: "include"` in `fetchOptions`. See [Setup](#setup) section above.

### Unlink Telegram Account

```typescript
await authClient.unlinkTelegram();
```

### Telegram Mini Apps (NEW in v0.2.0)

Authenticate users directly from Telegram Mini Apps. Because regular OAuth wasn't confusing enough.

**Server configuration:**

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your database config */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: "your_bot_username",
      miniApp: {
        enabled: true,
        validateInitData: true,
        allowAutoSignin: true,
      },
    }),
  ],
});
```

**Client usage - Auto sign-in:**

```typescript
"use client";

import { authClient } from "./auth-client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function MiniAppAuth() {
  const router = useRouter();

  useEffect(() => {
    // Automatically sign in when Mini App opens
    async function autoSignIn() {
      try {
        const result = await authClient.autoSignInFromMiniApp();
        console.log("Signed in:", result.user);
        router.push("/dashboard");
      } catch (error) {
        console.error("Auto sign-in failed:", error);
      }
    }

    autoSignIn();
  }, [router]);

  return <div>Signing in...</div>;
}
```

**Manual sign-in with initData:**

```typescript
// Get initData from Telegram WebApp
const initData = window.Telegram.WebApp.initData;

// Sign in
const result = await authClient.signInWithMiniApp(initData);
console.log("User:", result.user);
```

**Validate initData without signing in:**

```typescript
const initData = window.Telegram.WebApp.initData;
const validation = await authClient.validateMiniApp(initData);

if (validation.data?.valid) {
  console.log("User data:", validation.data.data.user);
  console.log("Is premium:", validation.data.data.user?.is_premium);
  console.log("Language:", validation.data.data.user?.language_code);
}
```

**Mini App features:**

- ✅ Automatic authentication from `Telegram.WebApp.initData` (it just works™)
- ✅ Access to additional user data (language, premium status, etc.) (stalk your users responsibly)
- ✅ Chat context information (type, instance, start params) (context is king)
- ✅ Secure HMAC-SHA-256 verification
- ✅ Auto-create users on first sign-in (onboarding speedrun)
- ✅ Custom user data mapping (map it your way)

## Configuration Options

### Server Plugin Options

```typescript
type TelegramPluginOptions = {
  /**
   * Bot token from @BotFather (required)
   */
  botToken: string;

  /**
   * Bot username without @ (required)
   */
  botUsername: string;

  /**
   * Allow users to link Telegram to existing accounts
   * @default true
   */
  allowUserToLink?: boolean;

  /**
   * Automatically create user if doesn't exist
   * @default true
   */
  autoCreateUser?: boolean;

  /**
   * Maximum age of auth_date in seconds (prevents replay attacks)
   * @default 86400 (24 hours)
   */
  maxAuthAge?: number;

  /**
   * Custom function to map Telegram data to user object
   */
  mapTelegramDataToUser?: (data: TelegramAuthData) => {
    name?: string;
    email?: string;
    image?: string;
    [key: string]: any;
  };

  /**
   * Telegram Mini Apps configuration (NEW in v0.2.0)
   */
  miniApp?: {
    /**
     * Enable Telegram Mini Apps support
     * @default false
     */
    enabled?: boolean;

    /**
     * Validate initData from Mini Apps
     * @default true
     */
    validateInitData?: boolean;

    /**
     * Allow automatic sign-in from Mini Apps
     * @default true
     */
    allowAutoSignin?: boolean;

    /**
     * Custom function to map Mini App user data to user object
     */
    mapMiniAppDataToUser?: (data: TelegramMiniAppUser) => {
      name?: string;
      email?: string;
      image?: string;
      [key: string]: any;
    };
  };
};
```

### Widget Options

```typescript
type TelegramWidgetOptions = {
  /**
   * Button size
   * @default "large"
   */
  size?: "large" | "medium" | "small";

  /**
   * Show user photo
   * @default true
   */
  showUserPhoto?: boolean;

  /**
   * Button corner radius
   * @default 20
   */
  cornerRadius?: number;

  /**
   * Request write access permission
   * @default false
   */
  requestAccess?: boolean;

  /**
   * Language code (e.g., "en", "pl")
   */
  lang?: string;
};
```

## Advanced Usage

### Custom User Mapping

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "your_bot",
  mapTelegramDataToUser: (data) => ({
    name: data.username || data.first_name,
    image: data.photo_url,
    // Add custom fields
    displayName: `${data.first_name} (Telegram)`,
  }),
});
```

### Using Redirect Flow

Instead of callback, you can use redirect:

```typescript
authClient.initTelegramWidgetRedirect(
  "telegram-login-container",
  "/auth/telegram/callback", // Your callback URL
  { size: "large" }
);
```

Then handle the callback:

```typescript
// In your /auth/telegram/callback page
const urlParams = new URLSearchParams(window.location.search);
const authData = {
  id: Number(urlParams.get("id")),
  first_name: urlParams.get("first_name")!,
  last_name: urlParams.get("last_name") || undefined,
  username: urlParams.get("username") || undefined,
  photo_url: urlParams.get("photo_url") || undefined,
  auth_date: Number(urlParams.get("auth_date")),
  hash: urlParams.get("hash")!,
};

await authClient.signInWithTelegram(authData);
```

## API Reference

### Server Endpoints

The plugin adds the following endpoints to your Better Auth instance:

- `POST /telegram/signin` - Sign in with Telegram authentication data
- `POST /telegram/link` - Link Telegram to current user (requires authentication)
- `POST /telegram/unlink` - Unlink Telegram account (requires authentication)
- `GET /telegram/config` - Get bot configuration (returns bot username)

### Client Methods

- `signInWithTelegram(authData)` - Sign in with Telegram auth data
- `linkTelegram(authData)` - Link Telegram to current account
- `unlinkTelegram()` - Unlink Telegram from current account
- `getTelegramConfig()` - Get bot configuration
- `initTelegramWidget(containerId, options, onAuth)` - Initialize login widget with callback
- `initTelegramWidgetRedirect(containerId, redirectUrl, options)` - Initialize login widget with redirect

## Database Schema

The plugin extends the Better Auth schema with the following fields:

**User table:**

- `telegramId` (string, optional) - Telegram user ID
- `telegramUsername` (string, optional) - Telegram username

**Account table:**

- `telegramId` (string, optional) - Telegram user ID
- `telegramUsername` (string, optional) - Telegram username

## Security

- Uses HMAC-SHA-256 to verify authentication data integrity
- Checks `auth_date` to prevent replay attacks (default: 24 hours max age)
- Validates all required fields before processing (no vibes, just validation)
- Bot token is never exposed to the client (obviously)
- Secret key for HMAC is derived from SHA-256 hash of bot token (inception, but for hashing)

Is it bulletproof? No. Is it better than storing passwords in plain text? Absolutely.

## Troubleshooting

### Widget not showing

Before panicking, check:

1. Did you set domain with @BotFather using `/setdomain`? (easy to forget, trust me)
2. Is `botUsername` correct? (without the @, Telegram is picky)
3. Does the container element exist in DOM before calling `initTelegramWidget`? (timing is everything)
4. Are you using HTTPS and a public domain? (localhost doesn't count, use ngrok)

### Authentication fails

The usual suspects:

- Bot token wrong in env variables (copy-paste errors are a programmer's best friend)
- Domain doesn't match what you told @BotFather (consistency matters)
- `auth_date` too old (default max: 24 hours, no time travel allowed)
- Check browser console (errors hide there like shy children)

### Local Development Issues

Telegram hates localhost. Here's the workaround:

1. Install ngrok: `npm install -g ngrok`
2. Start your dev server: `npm run dev`
3. Start ngrok tunnel: `ngrok http 3000`
4. Use the ngrok URL in @BotFather's `/setdomain`
5. Set `NEXT_PUBLIC_APP_URL` to your ngrok URL

Yes, it's annoying. No, there's no better way. Welcome to OAuth.

## Examples

Check out the [examples](./examples) directory for complete implementations:

- Next.js App Router (the new hotness)
- Next.js Pages Router (the old reliable)
- React SPA (classic)
- Vanilla JavaScript (respect)

Or don't. You probably know what you're doing.

## Links

- [Better Auth Documentation](https://better-auth.com) — the thing this plugin plugs into
- [Telegram Login Widget Docs](https://core.telegram.org/widgets/login) — official Telegram docs (surprisingly readable)
- [GitHub Repository](https://github.com/vcode-sh/better-auth-telegram) — where the code lives

## Contributing

Found a bug? Have an idea? Want to roast my TypeScript?

Open an issue or PR on [GitHub](https://github.com/vcode-sh/better-auth-telegram). All contributions welcome. Even the snarky ones.

## License

MIT — do whatever you want with it. I'm not your lawyer.

## Author

Created by [Vibe Code](https://x.com/vcode_sh)
