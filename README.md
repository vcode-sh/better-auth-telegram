# better-auth-telegram

Telegram authentication plugin for [Better Auth](https://better-auth.com).

## Features

- 🔐 Sign in with Telegram Login Widget
- 🔗 Link/unlink Telegram accounts to existing users
- ✅ HMAC-SHA-256 verification for security
- 🎨 Customizable login widget
- 📦 Full TypeScript support
- 🚀 Framework-agnostic

## Installation

```bash
npm install better-auth-telegram
# or
pnpm add better-auth-telegram
# or
yarn add better-auth-telegram
```

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow the instructions
3. Save the bot token
4. Send `/setdomain` to @BotFather and provide your website domain

**Note:** For local development, you'll need to use a tunneling service like [ngrok](https://ngrok.com) since Telegram requires HTTPS and a public domain.

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
  baseURL: typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL,
  plugins: [telegramClient()],
});
```

### 3. Database Setup

The plugin extends Better Auth's schema with Telegram-specific fields. If using Prisma, add these fields to your schema:

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

Then run migrations:

```bash
npx prisma migrate dev
```

## Usage

### Sign In with Telegram

**React/Next.js example:**

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

**Vanilla JavaScript:**

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

### Unlink Telegram Account

```typescript
await authClient.unlinkTelegram();
```

## Configuration Options

### Server Plugin Options

```typescript
interface TelegramPluginOptions {
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
}
```

### Widget Options

```typescript
interface TelegramWidgetOptions {
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
}
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
- Validates all required fields before processing
- Bot token is never exposed to the client
- Secret key for HMAC is derived from SHA-256 hash of bot token

## Troubleshooting

### Widget not showing

Make sure you:
1. Set domain with @BotFather using `/setdomain`
2. Provided correct `botUsername` (without @)
3. Container element exists in DOM before calling `initTelegramWidget`
4. Using HTTPS and a public domain (use ngrok for local development)

### Authentication fails

- Verify bot token is correct in environment variables
- Check that domain matches what you set in @BotFather
- Ensure `auth_date` is not too old (default max: 24 hours)
- Check browser console for error messages

### Local Development Issues

For local development with Telegram:
1. Install ngrok: `npm install -g ngrok`
2. Start your dev server: `npm run dev`
3. Start ngrok tunnel: `ngrok http 3000`
4. Use the ngrok URL in @BotFather's `/setdomain`
5. Set `NEXT_PUBLIC_APP_URL` to your ngrok URL

## Examples

Check out the [examples](./examples) directory for complete implementations:
- Next.js App Router
- Next.js Pages Router
- React SPA
- Vanilla JavaScript

## Links

- [Better Auth Documentation](https://better-auth.com)
- [Telegram Login Widget Documentation](https://core.telegram.org/widgets/login)
- [GitHub Repository](https://github.com/vcode-sh/better-auth-telegram)

## Contributing

Contributions are welcome! Please open an issue or PR on [GitHub](https://github.com/vcode-sh/better-auth-telegram).

## License

MIT

## Author

Created by [Vibe Code](https://vcode.sh) - [hello@vcode.sh](mailto:hello@vcode.sh)
