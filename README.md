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

### 2. Configure Better Auth

**Server-side (`auth.ts`):**

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  // ... other options
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: "your_bot_username", // without @
    }),
  ],
});
```

**Client-side:**

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  plugins: [telegramClient()],
});
```

## Usage

### Sign In with Telegram

**React example:**

```tsx
import { authClient } from "./auth-client";
import { useEffect } from "react";

function TelegramLogin() {
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
        console.log("Signed in:", result);
        // Redirect or update UI
      }
    );
  }, []);

  return <div id="telegram-login-container"></div>;
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

- `POST /telegram/signin` - Sign in with Telegram
- `POST /telegram/link` - Link Telegram to current user (requires auth)
- `POST /telegram/unlink` - Unlink Telegram account (requires auth)
- `GET /telegram/config` - Get bot configuration

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
- `telegramId` (string, optional)
- `telegramUsername` (string, optional)

**Account table:**
- `telegramId` (string, optional)
- `telegramUsername` (string, optional)

## Security

- Uses HMAC-SHA-256 to verify authentication data
- Checks `auth_date` to prevent replay attacks (default: 24 hours)
- Validates all required fields before processing
- Bot token is never exposed to the client

## Troubleshooting

### Widget not showing

Make sure you:
1. Set domain with @BotFather using `/setdomain`
2. Provided correct `botUsername` (without @)
3. Container element exists in DOM

### Authentication fails

- Verify bot token is correct
- Check that domain is set in @BotFather
- Ensure `auth_date` is not too old (default max: 24 hours)

## Examples

Check out the [examples](./examples) directory for:
- Next.js App Router
- Next.js Pages Router
- React SPA
- Vanilla JavaScript

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.

## Links

- [Better Auth Documentation](https://better-auth.com)
- [Telegram Login Widget Documentation](https://core.telegram.org/widgets/login)
- [GitHub Repository](https://github.com/your-username/better-auth-telegram)
