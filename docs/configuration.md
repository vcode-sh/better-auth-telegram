# Configuration Guide

Comprehensive guide to configuring the better-auth-telegram plugin.

## Table of Contents

- [Server Configuration](#server-configuration)
- [Client Configuration](#client-configuration)
- [Environment Variables](#environment-variables)
- [Widget Customization](#widget-customization)
- [User Data Mapping](#user-data-mapping)
- [Session Configuration](#session-configuration)
- [Database Configuration](#database-configuration)

## Server Configuration

### Basic Setup

Minimum required configuration:

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your database config */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,
    }),
  ],
});
```

### Advanced Configuration

Full configuration with all options:

```typescript
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",

  plugins: [
    telegram({
      // Required: Bot credentials
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,

      // Optional: Feature flags
      allowUserToLink: true,      // Allow linking Telegram to existing accounts
      autoCreateUser: true,       // Auto-create users on first sign-in

      // Optional: Security settings
      maxAuthAge: 86400,         // 24 hours in seconds

      // Optional: Custom user mapping
      mapTelegramDataToUser: (data) => ({
        name: data.username || `${data.first_name} ${data.last_name || ""}`.trim(),
        email: undefined,
        image: data.photo_url,
        // Add custom fields
        locale: data.language_code,
      }),
    }),
  ],

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7,    // 7 days
    updateAge: 60 * 60 * 24,        // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,               // 5 minutes
    },
  },

  // Advanced options
  advanced: {
    generateId: () => generateCustomId(),
    cookieSameSite: "lax",
    useSecureCookies: true,
  },
});
```

## Client Configuration

### Basic Setup

Minimum required configuration:

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: {
    credentials: "include", // Required for session cookies
  },
  plugins: [telegramClient()],
});
```

### Production-Ready Configuration

Recommended setup for production:

```typescript
"use client";

import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

// Use window.location.origin in browser, env var in SSR
const getBaseURL = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [telegramClient()],
  fetchOptions: {
    credentials: "include", // Include cookies
  },
});
```

## Environment Variables

### Required Variables

Create a `.env.local` file (for Next.js) or `.env` file:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
TELEGRAM_BOT_USERNAME="your_bot_username"

# Better Auth Configuration
BETTER_AUTH_SECRET="your-secret-key-generated-with-openssl"
BETTER_AUTH_URL="https://your-domain.com"

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
# or for SQLite:
DATABASE_URL="file:./dev.db"

# Framework-specific (Next.js)
NEXT_PUBLIC_APP_URL="https://your-domain.com"
```

### Generating Secrets

Generate a secure secret for `BETTER_AUTH_SECRET`:

```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Development vs Production

**Development (.env.local):**

```env
TELEGRAM_BOT_TOKEN="your_bot_token"
TELEGRAM_BOT_USERNAME="your_bot"
BETTER_AUTH_SECRET="dev-secret-key"
BETTER_AUTH_URL="https://abc123.ngrok-free.app"
NEXT_PUBLIC_APP_URL="https://abc123.ngrok-free.app"
DATABASE_URL="file:./dev.db"
```

**Production (.env.production):**

```env
TELEGRAM_BOT_TOKEN="your_bot_token"
TELEGRAM_BOT_USERNAME="your_bot"
BETTER_AUTH_SECRET="production-secret-key-very-long"
BETTER_AUTH_URL="https://yourdomain.com"
NEXT_PUBLIC_APP_URL="https://yourdomain.com"
DATABASE_URL="postgresql://user:pass@host:5432/prod_db"
```

## Widget Customization

### Size Options

```typescript
// Large button (default)
authClient.initTelegramWidget(
  "container",
  { size: "large" },
  callback
);

// Medium button
authClient.initTelegramWidget(
  "container",
  { size: "medium" },
  callback
);

// Small button
authClient.initTelegramWidget(
  "container",
  { size: "small" },
  callback
);
```

### Visual Customization

```typescript
authClient.initTelegramWidget(
  "telegram-login",
  {
    size: "large",
    showUserPhoto: true,    // Show user's profile photo
    cornerRadius: 20,       // Border radius in pixels (0-20)
    requestAccess: false,   // Request write access (not recommended)
    lang: "en",            // Language code
  },
  callback
);
```

### Language Support

Set the widget language:

```typescript
authClient.initTelegramWidget(
  "container",
  {
    lang: "en",    // English
    // Other options: "ru", "pl", "es", "de", "it", "fr", etc.
  },
  callback
);
```

### Multiple Widgets

You can have multiple widgets on the same page:

```typescript
// Sign in widget
authClient.initTelegramWidget(
  "signin-widget",
  { size: "large" },
  async (data) => {
    await authClient.signInWithTelegram(data);
  }
);

// Link account widget (for authenticated users)
authClient.initTelegramWidget(
  "link-widget",
  { size: "small" },
  async (data) => {
    await authClient.linkTelegram(data);
  }
);
```

## User Data Mapping

### Default Mapping

By default, the plugin maps Telegram data as follows:

```typescript
{
  name: data.username || data.first_name,
  email: undefined,  // Telegram doesn't provide email
  image: data.photo_url,
}
```

### Custom Mapping

Customize how Telegram data is mapped to user fields:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  mapTelegramDataToUser: (data) => {
    // Full name with fallback
    const fullName = data.last_name
      ? `${data.first_name} ${data.last_name}`
      : data.first_name;

    return {
      name: fullName,
      email: undefined,
      image: data.photo_url,

      // Custom fields (ensure they exist in your schema)
      displayName: data.username || fullName,
      telegramFirstName: data.first_name,
      telegramLastName: data.last_name,
      preferredName: data.username || data.first_name,
    };
  },
})
```

### Advanced Mapping Examples

**Use username with fallback:**

```typescript
mapTelegramDataToUser: (data) => ({
  name: data.username || data.first_name,
  image: data.photo_url,
  email: undefined,
})
```

**Include metadata:**

```typescript
mapTelegramDataToUser: (data) => ({
  name: data.username || data.first_name,
  image: data.photo_url,
  email: undefined,
  metadata: {
    telegramId: data.id.toString(),
    authenticatedVia: "telegram",
    hasUsername: !!data.username,
  },
})
```

**Conditional logic:**

```typescript
mapTelegramDataToUser: (data) => {
  const isVerified = data.username !== undefined;

  return {
    name: data.username || data.first_name,
    image: data.photo_url,
    email: undefined,
    emailVerified: false,
    role: isVerified ? "user" : "unverified_user",
  };
}
```

## Session Configuration

### Basic Session Settings

```typescript
export const auth = betterAuth({
  // ... other config
  session: {
    expiresIn: 60 * 60 * 24 * 7,    // Session expires in 7 days
    updateAge: 60 * 60 * 24,        // Update session every 24 hours
  },
});
```

### Advanced Session Configuration

```typescript
export const auth = betterAuth({
  // ... other config
  session: {
    // Session expiry
    expiresIn: 60 * 60 * 24 * 7,    // 7 days
    updateAge: 60 * 60 * 24,        // 1 day

    // Cookie configuration
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,               // 5 minutes
    },

    // Session token length
    tokenLength: 32,

    // Fresh login requirement
    freshAge: 60 * 15,              // 15 minutes
  },

  advanced: {
    cookieSameSite: "lax",          // or "strict", "none"
    useSecureCookies: true,         // Use Secure flag (HTTPS only)
    cookieDomain: undefined,        // Auto-detect
  },
});
```

### Session Length Recommendations

**Short-lived (Banking, Finance):**

```typescript
session: {
  expiresIn: 60 * 15,        // 15 minutes
  updateAge: 60 * 5,         // 5 minutes
}
```

**Medium-lived (E-commerce, SaaS):**

```typescript
session: {
  expiresIn: 60 * 60 * 24,   // 1 day
  updateAge: 60 * 60 * 4,    // 4 hours
}
```

**Long-lived (Social, Content):**

```typescript
session: {
  expiresIn: 60 * 60 * 24 * 30,  // 30 days
  updateAge: 60 * 60 * 24 * 7,   // 7 days
}
```

## Database Configuration

### Prisma (Recommended)

```typescript
import { PrismaClient } from "@prisma/client";
import { prismaAdapter } from "better-auth/adapters/prisma";

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql", // or "mysql", "sqlite"
  }),
  // ... rest of config
});
```

### Kysely

```typescript
import { Kysely } from "kysely";
import { kyselyAdapter } from "better-auth/adapters/kysely";

const db = new Kysely({
  // ... kysely config
});

export const auth = betterAuth({
  database: kyselyAdapter(db, {
    // ... adapter options
  }),
  // ... rest of config
});
```

### Drizzle

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

const db = drizzle(/* connection */);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    // ... adapter options
  }),
  // ... rest of config
});
```

## Security Configuration

### Authentication Age Limits

Control how long authentication data is valid:

```typescript
telegram({
  // ... other options
  maxAuthAge: 3600,  // 1 hour (in seconds)
})
```

**Recommendations:**

- **High security:** 3600 (1 hour)
- **Balanced:** 86400 (24 hours) - default
- **Relaxed:** 259200 (3 days)

### Disable Features

For security-sensitive applications:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,

  // Disable automatic user creation
  autoCreateUser: false,

  // Disable account linking
  allowUserToLink: false,

  // Strict auth age limit
  maxAuthAge: 3600,
})
```

## TypeScript Configuration

Ensure proper type inference:

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

### Type Augmentation

Extend types with custom fields:

```typescript
// types/better-auth.d.ts
import type { Session, User } from "better-auth";

declare module "better-auth" {
  interface User {
    telegramId?: string;
    telegramUsername?: string;
    // Add your custom fields
    displayName?: string;
    locale?: string;
  }

  interface Session {
    // Add session custom fields if needed
  }
}
```

## Framework-Specific Configuration

### Next.js App Router

```typescript
// lib/auth.ts (Server)
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  /* config */
});

// lib/auth-client.ts (Client)
"use client";

import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL,
  fetchOptions: {
    credentials: "include", // Required for session cookies
  },
  plugins: [telegramClient()],
});

// app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

const handler = toNextJsHandler(auth);
export { handler as GET, handler as POST };
```

### Next.js Pages Router

```typescript
// lib/auth.ts
export const auth = betterAuth({
  /* config */
});

// pages/api/auth/[...all].ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export default toNextJsHandler(auth);
```

### Express.js

```typescript
import express from "express";
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

const app = express();

export const auth = betterAuth({
  /* config */
});

app.all("/api/auth/*", (req, res) => {
  return auth.handler(req, res);
});
```

## Testing Configuration

### Test Environment

```typescript
// auth.test.ts
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const testAuth = betterAuth({
  database: {
    /* in-memory database */
  },
  secret: "test-secret",
  baseURL: "http://localhost:3000",
  plugins: [
    telegram({
      botToken: "test_bot_token",
      botUsername: "test_bot",
      maxAuthAge: 86400,
    }),
  ],
});
```

## Next Steps

- [API Reference](./api-reference.md)
- [Security Best Practices](./security.md)
- [Troubleshooting](./troubleshooting.md)
