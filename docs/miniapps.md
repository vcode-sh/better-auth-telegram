# Telegram Mini Apps Guide

Complete guide for implementing Telegram Mini Apps authentication with better-auth-telegram v0.2.0+.

## Table of Contents

- [Overview](#overview)
- [Setup Guide](#setup-guide)
- [Server Configuration](#server-configuration)
- [Client Implementation](#client-implementation)
- [Testing](#testing)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Examples](#examples)

## Overview

Telegram Mini Apps are web applications that run inside the Telegram app, providing seamless authentication and access to Telegram user data without requiring a separate login widget.

### Key Features

- ✅ **Auto-authentication** - Users are automatically signed in when they open your Mini App
- ✅ **Rich user data** - Access to language, premium status, and more
- ✅ **Context information** - Chat type, start parameters, query IDs
- ✅ **Secure verification** - HMAC-SHA-256 validation using WebAppData secret
- ✅ **No popup required** - Unlike Login Widget, no separate authorization flow

### Mini Apps vs Login Widget

| Feature | Login Widget | Mini Apps |
|---------|-------------|-----------|
| Use case | External websites | Apps inside Telegram |
| User action | Click & authorize | Automatic |
| Integration | Widget on page | Full web app |
| Context data | Basic user info | Full context + chat info |
| Premium status | ❌ | ✅ |
| Language code | ❌ | ✅ |
| Start params | ❌ | ✅ |

## Setup Guide

### Step 1: Create a Telegram Bot

If you haven't already:

1. Open Telegram and find [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow instructions
3. Save your bot token
4. Note your bot username (without @)

### Step 2: Create a Mini App

1. Send `/newapp` to @BotFather
2. Choose your bot
3. Provide:
   - **Title**: Your app name (e.g., "My Auth App")
   - **Description**: Short description
   - **Photo**: App icon (512x512 PNG)
   - **Demo GIF/Video**: Optional preview
   - **Web App URL**: Your app URL (must be HTTPS)
   - **Short name**: URL identifier (e.g., "myapp")

Example:
```
/newapp
→ Select bot: @mybot
→ Title: My Authentication App
→ Description: Secure login with Telegram
→ Photo: [upload 512x512 icon]
→ Web App URL: https://myapp.com/miniapp
→ Short name: authapp
```

Result: `t.me/mybot/authapp`

### Step 3: Development Setup with ngrok

For local development, you need HTTPS:

1. **Install ngrok**:
   ```bash
   npm install -g ngrok
   # or
   brew install ngrok
   ```

2. **Start your dev server**:
   ```bash
   npm run dev
   # Server running on http://localhost:3000
   ```

3. **Create ngrok tunnel**:
   ```bash
   ngrok http 3000
   ```

4. **Update Mini App URL in @BotFather**:
   ```
   /myapps
   → Select your Mini App
   → Edit Web App URL
   → Enter: https://your-ngrok-id.ngrok.io/miniapp
   ```

## Server Configuration

### Basic Setup

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your database config */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,

      // Enable Mini Apps
      miniApp: {
        enabled: true,
        validateInitData: true,
        allowAutoSignin: true,
      },
    }),
  ],
});
```

### Advanced Configuration

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "mybot",

  miniApp: {
    enabled: true,

    // Validate initData from Telegram (recommended: true)
    validateInitData: true,

    // Allow auto-signin when user opens Mini App (recommended: true)
    allowAutoSignin: true,

    // Custom user data mapping
    mapMiniAppDataToUser: (user) => ({
      name: user.username || user.first_name,
      email: undefined, // Telegram doesn't provide email
      image: user.photo_url,

      // Store additional fields
      locale: user.language_code,
      isPremium: user.is_premium,
    }),
  },
})
```

### Environment Variables

```bash
# .env.local
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
TELEGRAM_BOT_USERNAME="mybot"
BETTER_AUTH_SECRET="your-secret-key"
BETTER_AUTH_URL="https://your-ngrok-id.ngrok.io"
```

## Client Implementation

### 1. Install Telegram WebApp SDK

Add to your HTML layout:

```html
<!-- In your layout.tsx or index.html -->
<head>
  <script src="https://telegram.org/js/telegram-web-app.js" async></script>
</head>
```

### 2. Create Auth Client

```typescript
// lib/auth-client.ts
"use client";

import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL,
  plugins: [telegramClient()],
});
```

### 3. Auto Sign-in Component

```typescript
// app/miniapp/page.tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function MiniAppPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function autoSignIn() {
      try {
        setStatus("Checking Telegram environment...");

        // Wait for Telegram WebApp SDK to load
        let attempts = 0;
        while (attempts < 50 && !(window as any).Telegram?.WebApp) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }

        const Telegram = (window as any).Telegram;

        if (!Telegram?.WebApp) {
          setError("Not running in Telegram Mini App");
          return;
        }

        setStatus("Authenticating...");

        // Auto sign-in using Telegram.WebApp.initData
        const result = await authClient.autoSignInFromMiniApp();

        if (result.data?.user) {
          setStatus("✅ Signed in successfully!");

          // Redirect to main app
          setTimeout(() => {
            router.push("/dashboard");
          }, 1500);
        } else {
          setError("Failed to sign in");
        }
      } catch (err: any) {
        setError(err.message);
        console.error("Mini App auth error:", err);
      }
    }

    autoSignIn();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold mb-4">Telegram Mini App</h1>

        <div className="space-y-4">
          <p className="text-gray-700">{status}</p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-4">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 4. Manual Sign-in (Alternative)

```typescript
// If you want more control over the sign-in flow
import { authClient } from "@/lib/auth-client";

async function manualSignIn() {
  const Telegram = (window as any).Telegram;

  if (!Telegram?.WebApp?.initData) {
    throw new Error("No initData available");
  }

  // Get initData from Telegram
  const initData = Telegram.WebApp.initData;

  // Validate initData (optional, but recommended)
  const validation = await authClient.validateMiniApp(initData);

  if (!validation.data?.valid) {
    throw new Error("Invalid initData");
  }

  // Sign in
  const result = await authClient.signInWithMiniApp(initData);

  return result.data;
}
```

### 5. Access User Data

```typescript
// After sign-in, access additional Mini App data
const Telegram = (window as any).Telegram;
const WebApp = Telegram?.WebApp;

if (WebApp) {
  // User info
  console.log("User:", WebApp.initDataUnsafe?.user);
  console.log("Is Premium:", WebApp.initDataUnsafe?.user?.is_premium);
  console.log("Language:", WebApp.initDataUnsafe?.user?.language_code);

  // Context info
  console.log("Chat type:", WebApp.initDataUnsafe?.chat_type);
  console.log("Start param:", WebApp.initDataUnsafe?.start_param);

  // App info
  console.log("Theme:", WebApp.colorScheme); // 'light' or 'dark'
  console.log("Version:", WebApp.version);
  console.log("Platform:", WebApp.platform); // 'ios', 'android', 'macos', etc.
}
```

## Testing

### Test Locally

1. **Start dev server with ngrok**:
   ```bash
   # Terminal 1: Start your app
   npm run dev

   # Terminal 2: Start ngrok
   ngrok http 3000
   ```

2. **Update Mini App URL**:
   - Copy ngrok URL (e.g., `https://abc123.ngrok.io`)
   - In @BotFather: `/myapps` → Edit Web App URL
   - Set to: `https://abc123.ngrok.io/miniapp`

3. **Open Mini App in Telegram**:
   - Find your bot in Telegram
   - Click on the Mini App button/menu
   - Or open: `t.me/yourbot/yourapp`

### Test Checklist

- [ ] Mini App opens in Telegram
- [ ] Telegram WebApp SDK loads (check `window.Telegram`)
- [ ] initData is available (`Telegram.WebApp.initData`)
- [ ] Auto sign-in works
- [ ] User is redirected to main app
- [ ] Session persists on refresh
- [ ] User data is correct (name, username, etc.)
- [ ] Premium status detected (if applicable)
- [ ] Language code is correct
- [ ] Works on mobile (iOS/Android)
- [ ] Works on desktop (macOS/Windows)

### Debug Mode

Enable logging to see what's happening:

```typescript
useEffect(() => {
  const Telegram = (window as any).Telegram;

  console.log("=== Mini App Debug Info ===");
  console.log("WebApp available:", !!Telegram?.WebApp);
  console.log("initData:", Telegram?.WebApp?.initData);
  console.log("initDataUnsafe:", Telegram?.WebApp?.initDataUnsafe);
  console.log("Platform:", Telegram?.WebApp?.platform);
  console.log("Version:", Telegram?.WebApp?.version);
  console.log("=========================");
}, []);
```

## API Reference

### Server Endpoints

#### `POST /api/auth/telegram/miniapp/signin`

Sign in user with Mini App initData.

**Request:**
```json
{
  "initData": "user=%7B%22id%22%3A123...&auth_date=1234567890&hash=abc..."
}
```

**Response:**
```json
{
  "user": {
    "id": "...",
    "name": "John Doe",
    "telegramId": "123456789",
    "telegramUsername": "johndoe"
  },
  "session": {
    "token": "...",
    "expiresAt": "..."
  }
}
```

#### `POST /api/auth/telegram/miniapp/validate`

Validate initData without signing in.

**Request:**
```json
{
  "initData": "user=%7B%22id%22%3A123...&auth_date=1234567890&hash=abc..."
}
```

**Response:**
```json
{
  "valid": true,
  "data": {
    "user": {
      "id": 123456789,
      "first_name": "John",
      "username": "johndoe",
      "language_code": "en",
      "is_premium": true
    },
    "auth_date": 1234567890,
    "hash": "abc..."
  }
}
```

### Client Methods

#### `authClient.signInWithMiniApp(initData: string)`

Sign in with raw initData string.

```typescript
const initData = window.Telegram.WebApp.initData;
const result = await authClient.signInWithMiniApp(initData);
```

#### `authClient.validateMiniApp(initData: string)`

Validate initData without signing in.

```typescript
const validation = await authClient.validateMiniApp(initData);
if (validation.data?.valid) {
  console.log("Valid user:", validation.data.data.user);
}
```

#### `authClient.autoSignInFromMiniApp()`

Automatically get initData from Telegram.WebApp and sign in.

```typescript
const result = await authClient.autoSignInFromMiniApp();
console.log("User:", result.data?.user);
```

### Types

#### `TelegramMiniAppUser`

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
```

#### `TelegramMiniAppData`

```typescript
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
```

## Troubleshooting

### "Not running in Telegram Mini App"

**Cause**: Page opened in regular browser, not in Telegram.

**Solution**:
- Make sure you open the link through Telegram
- Use format: `t.me/yourbot/yourapp`
- Or click Mini App button in bot chat

### "Telegram.WebApp is undefined"

**Cause**: Telegram WebApp SDK not loaded.

**Solution**:
```html
<!-- Add to layout -->
<script src="https://telegram.org/js/telegram-web-app.js" async></script>

<!-- Wait for SDK in your code -->
while (!(window as any).Telegram?.WebApp) {
  await new Promise(resolve => setTimeout(resolve, 100));
}
```

### "No initData available"

**Cause**: Mini App not properly configured or opened outside Telegram.

**Solution**:
1. Check Web App URL in @BotFather is correct
2. Make sure it's HTTPS (use ngrok for local dev)
3. Open via `t.me/yourbot/yourapp`, not direct URL

### "Invalid initData" / 401 Unauthorized

**Cause**: initData validation failed (wrong bot token or expired).

**Solution**:
1. Check `TELEGRAM_BOT_TOKEN` in `.env` is correct
2. Check `auth_date` is not too old (default max: 24 hours)
3. Make sure you're using the bot that created the Mini App

### Authentication works but no redirect

**Cause**: Router/navigation not working.

**Solution**:
```typescript
// Use Next.js router
import { useRouter } from "next/navigation";
const router = useRouter();
router.push("/dashboard");

// Or regular navigation
window.location.href = "/dashboard";
```

### Works locally but not in production

**Checklist**:
- [ ] Environment variables set in production
- [ ] HTTPS enabled (required by Telegram)
- [ ] Correct Web App URL in @BotFather
- [ ] CORS headers configured
- [ ] Telegram WebApp SDK loading correctly

## Examples

### Complete Next.js Example

See [better-auth-telegram-test](https://github.com/vcode-sh/better-auth-telegram/tree/main/examples/next-app) for a complete working example.

### React SPA Example

```typescript
// src/App.tsx
import { useEffect, useState } from 'react';
import { authClient } from './auth-client';

function MiniApp() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function init() {
      // Wait for Telegram SDK
      while (!(window as any).Telegram?.WebApp) {
        await new Promise(r => setTimeout(r, 100));
      }

      // Auto sign-in
      const result = await authClient.autoSignInFromMiniApp();
      setUser(result.data?.user);
    }

    init();
  }, []);

  return user ? (
    <div>Welcome, {user.name}!</div>
  ) : (
    <div>Loading...</div>
  );
}
```

### Vanilla JavaScript Example

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
  <div id="app">Loading...</div>

  <script type="module">
    import { createAuthClient } from 'better-auth/client';
    import { telegramClient } from 'better-auth-telegram/client';

    const authClient = createAuthClient({
      baseURL: window.location.origin,
      plugins: [telegramClient()],
    });

    async function init() {
      // Wait for SDK
      while (!window.Telegram?.WebApp) {
        await new Promise(r => setTimeout(r, 100));
      }

      // Sign in
      const result = await authClient.autoSignInFromMiniApp();

      if (result.data?.user) {
        document.getElementById('app').innerHTML =
          `Welcome, ${result.data.user.name}!`;
      }
    }

    init();
  </script>
</body>
</html>
```

## Best Practices

### Security

1. **Always validate initData** on the server
   ```typescript
   miniApp: {
     validateInitData: true, // Always true in production
   }
   ```

2. **Use HTTPS** everywhere (Telegram requirement)

3. **Set proper maxAuthAge** to prevent replay attacks
   ```typescript
   maxAuthAge: 3600, // 1 hour
   ```

4. **Never expose bot token** to client

### User Experience

1. **Show loading state** while authenticating
2. **Handle errors gracefully** with clear messages
3. **Use Telegram theme colors** for consistency
   ```typescript
   const WebApp = window.Telegram.WebApp;
   const theme = WebApp.themeParams;
   // Use theme.bg_color, theme.text_color, etc.
   ```

4. **Support both light and dark modes**
   ```typescript
   const isDark = WebApp.colorScheme === 'dark';
   ```

### Performance

1. **Lazy load Telegram SDK** (already async)
2. **Cache user data** after first load
3. **Use server-side rendering** where possible
4. **Minimize bundle size** for faster loads

## Additional Resources

- [Telegram Mini Apps Official Docs](https://core.telegram.org/bots/webapps)
- [Telegram WebApp API Reference](https://core.telegram.org/bots/webapps#initializing-mini-apps)
- [better-auth Documentation](https://better-auth.com)
- [Example Repository](https://github.com/vcode-sh/better-auth-telegram)

## Support

- **GitHub Issues**: [Report bugs](https://github.com/vcode-sh/better-auth-telegram/issues)
- **Discussions**: [Ask questions](https://github.com/vcode-sh/better-auth-telegram/discussions)
- **Email**: hello@vcode.sh
