# Troubleshooting Guide

Common issues and solutions for better-auth-telegram plugin.

## Table of Contents

- [Common Issues (Start Here)](#common-issues-start-here)
- [Widget Issues](#widget-issues)
- [Authentication Errors](#authentication-errors)
- [Session Problems](#session-problems)
- [Database Issues](#database-issues)
- [Environment and Configuration](#environment-and-configuration)
- [Development Issues](#development-issues)
- [Production Issues](#production-issues)

## Common Issues (Start Here)

### "Not authenticated" When Linking Telegram

**Symptom:** You get `{ error: "Not authenticated" }` when calling `linkTelegram()`, even though Telegram shows the bot as connected.

**Cause:** Session cookies aren't being sent with the request.

**Solution:**

Add `credentials: "include"` to your auth client config:

```typescript
// ❌ Wrong: Missing credentials
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [telegramClient()],
});

// ✅ Correct: Include credentials for cookies
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [telegramClient()],
});
```

Without `credentials: "include"`, your browser won't send cookies with the request. No cookies = no session = "Not authenticated" error.

**Why this happens:**

1. You sign in to your app (session cookie is set)
2. You authenticate with Telegram (this works fine)
3. Your app calls `linkTelegram()` to connect the accounts
4. Without `credentials: "include"`, the session cookie doesn't get sent
5. Server can't find your session
6. Returns "Not authenticated"

**Also check:**

Make sure your `baseURL` matches your actual domain:

```typescript
// ✅ Good: Auto-detect current origin
baseURL: typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL

// ❌ Bad: Different port/domain
baseURL: "http://localhost:4000"  // when your app runs on :3000
```

## Widget Issues

### Widget Not Showing

**Symptom:** The Telegram login button doesn't appear on the page.

**Common Causes:**

1. **Container element doesn't exist**

```typescript
// ❌ Wrong: Widget initialized before element exists
const App = () => {
  authClient.initTelegramWidget("container", {}, callback);
  return <div id="container"></div>;
};

// ✅ Correct: Use useEffect
const App = () => {
  useEffect(() => {
    authClient.initTelegramWidget("container", {}, callback);
  }, []);
  return <div id="container"></div>;
};
```

2. **Wrong container ID**

```typescript
// ❌ Wrong: Mismatched IDs
authClient.initTelegramWidget("telegram-widget", {}, callback);
return <div id="telegram-login"></div>;

// ✅ Correct: Matching IDs
authClient.initTelegramWidget("telegram-login", {}, callback);
return <div id="telegram-login"></div>;
```

3. **Domain not set in BotFather**

Check with @BotFather:
```
You: /setdomain
BotFather: Choose a bot...
You: @your_bot
BotFather: OK. Send me the domain...
You: yourdomain.com
```

4. **Script loading blocked**

Check browser console for:
- Content Security Policy (CSP) violations
- Ad blockers
- Network errors

**Solution:** Add CSP exception if needed:

```html
<meta http-equiv="Content-Security-Policy"
      content="script-src 'self' https://telegram.org;">
```

### Widget Shows Error Message

**Error:** "Bot domain invalid"

**Cause:** The domain in BotFather doesn't match your current domain.

**Solution:**
1. Check current domain in browser
2. Update with `/setdomain` in @BotFather
3. Make sure to enter domain without `https://`
4. For local dev, use ngrok domain

### Widget Not Responding

**Symptom:** Widget appears but clicking doesn't do anything.

**Debugging Steps:**

1. **Check browser console:**

```javascript
// Add error handling
authClient.initTelegramWidget(
  "container",
  {},
  async (authData) => {
    console.log("Received auth data:", authData);
    try {
      const result = await authClient.signInWithTelegram(authData);
      console.log("Sign in result:", result);
    } catch (error) {
      console.error("Sign in error:", error);
    }
  }
);
```

2. **Check network tab:**
- Look for failed requests to `/api/auth/telegram/signin`
- Check response status and body

3. **Verify callback is defined:**

```typescript
// ❌ Wrong: Undefined callback
authClient.initTelegramWidget("container", {}, undefined);

// ✅ Correct: Proper callback
authClient.initTelegramWidget("container", {}, async (data) => {
  await authClient.signInWithTelegram(data);
});
```

## Authentication Errors

### "Invalid authentication data"

**Cause:** HMAC verification failed.

**Possible Reasons:**

1. **Wrong bot token:**

```typescript
// Check .env file
TELEGRAM_BOT_TOKEN="correct_token_from_botfather"
```

2. **Token not loaded:**

```typescript
// Add validation
if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set");
}
```

3. **Token has leading/trailing spaces:**

```typescript
// Trim token
botToken: process.env.TELEGRAM_BOT_TOKEN!.trim()
```

4. **Using wrong bot:**

Make sure the bot token matches the bot username.

### "Authentication data is too old"

**Cause:** `auth_date` exceeds `maxAuthAge`.

**Solutions:**

1. **Increase max age:**

```typescript
telegram({
  maxAuthAge: 86400 * 2, // 2 days instead of 1
})
```

2. **Check server time:**

```bash
# Make sure server time is correct
date
```

If server time is wrong:
```bash
# Sync time (Linux)
sudo ntpdate -s time.nist.gov

# Or use systemd
sudo timedatectl set-ntp true
```

3. **Check for clock skew:**

```typescript
// Add logging
const authDate = data.auth_date;
const currentTime = Math.floor(Date.now() / 1000);
console.log("Auth date:", authDate);
console.log("Current time:", currentTime);
console.log("Difference:", currentTime - authDate);
```

### "User not found" or "Account doesn't exist"

**Cause:** `autoCreateUser` is disabled and user doesn't exist.

**Solution:**

Either enable auto-creation:

```typescript
telegram({
  autoCreateUser: true,
})
```

Or manually create users before they sign in.

### "Telegram account already linked"

**Cause:** Trying to link a Telegram account that's already linked to another user.

**Solution:**

User must first unlink from the other account:

```typescript
// Have user sign in with Telegram
await authClient.signInWithTelegram(data);

// Then unlink
await authClient.unlinkTelegram();

// Then sign in with desired account and link
await authClient.signIn(/* other method */);
await authClient.linkTelegram(data);
```

## Session Problems

### "No active session" After Successful Login

**Symptom:** User logs in successfully but session shows as empty.

**Common Causes:**

1. **Client using wrong baseURL:**

```typescript
// ❌ Wrong: Using different domain
export const authClient = createAuthClient({
  baseURL: "https://different-domain.com",
});

// ✅ Correct: Use same origin
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [telegramClient()],
});
```

2. **Cookies not being sent:**

```typescript
// Add credentials
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [telegramClient()],
});
```

3. **Cookie domain mismatch:**

Check browser DevTools → Application → Cookies:
- Cookie should be set for your domain
- Should have proper flags (HttpOnly, Secure if HTTPS)

4. **CORS issues:**

```typescript
// Server config
export const auth = betterAuth({
  advanced: {
    cors: {
      origin: ["https://your-frontend-domain.com"],
      credentials: true,
    },
  },
});
```

### Session Expires Too Quickly

**Cause:** Session configuration too short.

**Solution:**

```typescript
export const auth = betterAuth({
  session: {
    expiresIn: 60 * 60 * 24 * 7,    // 7 days
    updateAge: 60 * 60 * 24,        // Update every day
  },
});
```

### Session Not Updating

**Symptom:** Changes to user data don't reflect in session.

**Solution:**

Refresh session after updates:

```typescript
// After updating user
await authClient.getSession({ forceFresh: true });
```

Or invalidate and recreate:

```typescript
await authClient.signOut();
await authClient.signInWithTelegram(authData);
```

## Database Issues

### "no such table: user" or "no such table: account"

**Cause:** Database tables don't exist.

**Solution for Prisma:**

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Or for production
npx prisma migrate deploy
```

**Solution for other ORMs:**

Ensure migrations have been run and tables exist:

```sql
-- Check if tables exist (PostgreSQL)
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check if tables exist (SQLite)
SELECT name FROM sqlite_master WHERE type='table';
```

### "column does not exist: telegramId"

**Cause:** Schema not updated with Telegram fields.

**Solution:**

Add migration to add columns:

```sql
-- PostgreSQL/MySQL
ALTER TABLE "User" ADD COLUMN "telegramId" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramUsername" TEXT;
ALTER TABLE "Account" ADD COLUMN "telegramId" TEXT;
ALTER TABLE "Account" ADD COLUMN "telegramUsername" TEXT;

-- SQLite
ALTER TABLE User ADD COLUMN telegramId TEXT;
ALTER TABLE User ADD COLUMN telegramUsername TEXT;
ALTER TABLE Account ADD COLUMN telegramId TEXT;
ALTER TABLE Account ADD COLUMN telegramUsername TEXT;
```

### "unable to open database file"

**Cause:** Database file path is incorrect or doesn't exist.

**Solution for SQLite:**

```typescript
// Use absolute path
import path from "path";

const dbPath = path.join(process.cwd(), "prisma", "dev.db");

// Or in Prisma schema
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

### "Failed to initialize database adapter"

**Cause:** Database adapter not configured correctly.

**Solution:**

For Next.js, use Prisma adapter (not raw database):

```typescript
// ❌ Wrong: Using raw database in Next.js
import Database from "better-sqlite3";
const db = new Database("./dev.db");

export const auth = betterAuth({
  database: db,
});

// ✅ Correct: Using Prisma adapter
import { PrismaClient } from "@prisma/client";
import { prismaAdapter } from "better-auth/adapters/prisma";

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
});
```

## Environment and Configuration

### Environment Variables Not Loaded

**Symptom:** `process.env.VARIABLE_NAME` is `undefined`.

**Solutions:**

1. **Check file name:**
   - Next.js: `.env.local` (not `.env`)
   - Other: `.env`

2. **Restart dev server:**

```bash
# Kill server
Ctrl+C

# Restart
npm run dev
```

3. **Check .gitignore:**

Make sure `.env.local` is in `.gitignore`:

```gitignore
.env
.env.local
.env*.local
```

4. **Verify variable format:**

```env
# ✅ Correct
TELEGRAM_BOT_TOKEN="123:ABC"

# ❌ Wrong (spaces)
TELEGRAM_BOT_TOKEN = "123:ABC"

# ❌ Wrong (quotes in value)
TELEGRAM_BOT_TOKEN=""123:ABC""
```

5. **Client-side variables (Next.js):**

Client-side variables need `NEXT_PUBLIC_` prefix:

```env
NEXT_PUBLIC_APP_URL="https://..."
```

### "Cannot find module 'better-auth-telegram'"

**Cause:** Package not installed.

**Solution:**

```bash
# Install package
npm install better-auth-telegram

# Or reinstall node_modules
rm -rf node_modules package-lock.json
npm install
```

### TypeScript Errors

**Error:** "Property 'telegramId' does not exist on type 'User'"

**Solution:**

Add type augmentation:

```typescript
// types/better-auth.d.ts
import "better-auth";

declare module "better-auth" {
  interface User {
    telegramId?: string;
    telegramUsername?: string;
  }
}
```

## Development Issues

### ngrok URL Changes Every Restart

**Problem:** Free ngrok generates new URL each time.

**Solutions:**

1. **Upgrade to ngrok paid plan** for static domain

2. **Use localtunnel (alternative):**

```bash
npm install -g localtunnel
lt --port 3000 --subdomain myapp
```

3. **Deploy to staging environment:**
   - Vercel preview deployments
   - Netlify deploy previews
   - Railway/Render staging

### Cannot Test Locally Without ngrok

**Problem:** Telegram requires HTTPS and public domain.

**Solutions:**

1. **Use ngrok (recommended):**

```bash
ngrok http 3000
```

2. **Deploy to staging:**

```bash
# Vercel
vercel

# Netlify
netlify deploy
```

3. **Use test bot:**

Create a separate bot for development with relaxed settings.

### Hot Reload Breaking Widget

**Symptom:** Widget stops working after hot reload in development.

**Solution:**

Clear widget on unmount:

```typescript
useEffect(() => {
  authClient.initTelegramWidget("container", {}, callback);

  return () => {
    // Clean up
    const container = document.getElementById("container");
    if (container) {
      container.innerHTML = "";
    }
  };
}, []);
```

## Production Issues

### 500 Internal Server Error

**Debugging steps:**

1. **Check server logs:**

```typescript
// Add error logging
try {
  await authClient.signInWithTelegram(authData);
} catch (error) {
  console.error("Full error:", error);
  // Send to error tracking (Sentry, etc.)
}
```

2. **Check environment variables:**

```bash
# Verify all variables are set in production
echo $TELEGRAM_BOT_TOKEN
echo $BETTER_AUTH_SECRET
```

3. **Check database connection:**

```typescript
// Test database connection
try {
  await prisma.$connect();
  console.log("Database connected");
} catch (error) {
  console.error("Database error:", error);
}
```

### CORS Errors in Production

**Error:** "Access to fetch has been blocked by CORS policy"

**Solution:**

```typescript
export const auth = betterAuth({
  advanced: {
    cors: {
      origin: [
        "https://yourdomain.com",
        "https://www.yourdomain.com",
      ],
      credentials: true,
    },
  },
});
```

### Cookies Not Being Set

**Cause:** `Secure` flag with HTTP, or wrong domain.

**Solution:**

Ensure HTTPS in production:

```typescript
advanced: {
  useSecureCookies: process.env.NODE_ENV === "production",
  cookieDomain: undefined, // Let it auto-detect
}
```

### High Error Rates

**Debugging:**

1. **Add monitoring:**

```typescript
// Track authentication attempts
analytics.track("telegram_auth_attempt", {
  success: !result.error,
  error: result.error?.message,
});
```

2. **Check bot status:**

Talk to @BotFather:
```
/mybots
[Select your bot]
Bot Stats
```

3. **Review logs:**

Look for patterns in failed authentications.

## Getting Help

### Debug Information to Provide

When reporting issues, include:

1. **Plugin version:**

```bash
npm list better-auth-telegram
```

2. **Environment:**
   - Framework (Next.js, React, etc.)
   - Version
   - Node.js version (`node --version`)

3. **Configuration** (sanitized, no tokens):

```typescript
telegram({
  botUsername: "my_bot",
  allowUserToLink: true,
  autoCreateUser: true,
  maxAuthAge: 86400,
})
```

4. **Error messages:**
   - Full error text
   - Stack trace
   - Browser console errors

5. **Steps to reproduce:**
   - What you did
   - What you expected
   - What actually happened

### Where to Get Help

1. **GitHub Issues:**
   - [https://github.com/vcode-sh/better-auth-telegram/issues](https://github.com/vcode-sh/better-auth-telegram/issues)

2. **Better Auth Discord:**
   - [Better Auth Community](https://better-auth.com/discord)

3. **Email Support:**
   - [hello@vcode.sh](mailto:hello@vcode.sh)

### Before Opening an Issue

- [ ] Checked this troubleshooting guide
- [ ] Searched existing GitHub issues
- [ ] Verified environment variables are set
- [ ] Tested with latest version
- [ ] Can reproduce the issue consistently
- [ ] Have minimal reproduction example

## Common Error Codes

| Code | Meaning | Common Cause |
|------|---------|--------------|
| 400 | Bad Request | Invalid auth data, HMAC verification failed |
| 401 | Unauthorized | Not signed in, session expired |
| 403 | Forbidden | Action not allowed (e.g., linking disabled) |
| 409 | Conflict | Telegram account already linked |
| 500 | Server Error | Database error, configuration error |

## Next Steps

- [Security Best Practices](./security.md)
- [Configuration Guide](./configuration.md)
- [API Reference](./api-reference.md)
- [Usage Examples](./usage.md)
