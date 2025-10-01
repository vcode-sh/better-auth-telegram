# Installation Guide

This guide will walk you through installing and setting up the better-auth-telegram plugin.

## Prerequisites

Before you begin, make sure you have:

- Node.js 18+ installed
- A Better Auth project set up
- A Telegram account

## Step 1: Install the Package

Install the plugin using your preferred package manager:

```bash
# npm
npm install better-auth-telegram

# pnpm
pnpm add better-auth-telegram

# yarn
yarn add better-auth-telegram
```

## Step 2: Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Start a chat and send the command `/newbot`
3. Follow the instructions to choose a name and username for your bot
4. Save the bot token that BotFather provides (you'll need this later)
5. Copy your bot's username (without the @ symbol)

### Set the Domain

Once your bot is created, you need to set the domain where your app will be hosted:

1. Send `/setdomain` to @BotFather
2. Select your bot from the list
3. Enter your domain (e.g., `example.com` or `yourdomain.vercel.app`)

**Important Notes:**
- Telegram requires HTTPS and a public domain
- You cannot use `localhost` directly
- For local development, use a tunneling service like ngrok (see below)

## Step 3: Configure Environment Variables

Add the following environment variables to your `.env` or `.env.local` file:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN="your_bot_token_from_botfather"
TELEGRAM_BOT_USERNAME="your_bot_username"

# Better Auth Configuration
BETTER_AUTH_SECRET="your_secret_key"
BETTER_AUTH_URL="https://your-domain.com"

# For Next.js projects
NEXT_PUBLIC_APP_URL="https://your-domain.com"
```

To generate a secure secret for `BETTER_AUTH_SECRET`:

```bash
openssl rand -hex 32
```

## Step 4: Set Up Database Schema

The plugin extends Better Auth's database schema with Telegram-specific fields.

### Using Prisma (Recommended for Next.js)

Add the following fields to your Prisma schema:

```prisma
model User {
  id               String    @id @default(cuid())
  name             String
  email            String?   @unique
  emailVerified    Boolean   @default(false)
  image            String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  // Telegram fields
  telegramId       String?
  telegramUsername String?

  accounts Account[]
  sessions Session[]
}

model Account {
  id               String   @id @default(cuid())
  userId           String
  accountId        String
  providerId       String
  accessToken      String?
  refreshToken     String?
  idToken          String?
  expiresAt        DateTime?
  password         String?

  // Telegram fields
  telegramId       String?
  telegramUsername String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([providerId, accountId])
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  expiresAt DateTime
  token     String   @unique
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Verification {
  id         String   @id @default(cuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([identifier, value])
}
```

Then run the migration:

```bash
npx prisma migrate dev --name add_telegram_fields
```

### Using Other ORMs

If you're using Kysely, Drizzle, or another ORM, add equivalent fields:

- `telegramId` (string, nullable)
- `telegramUsername` (string, nullable)

to both the `User` and `Account` tables.

## Step 5: Configure Better Auth Server

Create or update your Better Auth server configuration:

```typescript
// lib/auth.ts or auth.ts
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";
import { PrismaClient } from "@prisma/client";
import { prismaAdapter } from "better-auth/adapters/prisma";

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "sqlite", // or "postgresql", "mysql"
  }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,
      allowUserToLink: true,
      autoCreateUser: true,
      maxAuthAge: 86400, // 24 hours
      mapTelegramDataToUser: (data) => ({
        name: data.username || data.first_name,
        image: data.photo_url,
        email: undefined, // Telegram doesn't provide email
      }),
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
});
```

## Step 6: Configure Better Auth Client

Create your client-side configuration:

```typescript
// lib/auth-client.ts or auth-client.ts
"use client";

import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [telegramClient()],
});
```

**Important:** Using `window.location.origin` ensures the client works correctly in both local and production environments.

## Step 7: Set Up API Route (Next.js)

For Next.js App Router, create an API route handler:

```typescript
// app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

const handler = toNextJsHandler(auth);

export { handler as GET, handler as POST };
```

For Next.js Pages Router:

```typescript
// pages/api/auth/[...all].ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export default toNextJsHandler(auth);
```

## Step 8: Local Development Setup with ngrok

Since Telegram requires HTTPS and a public domain, you'll need to use ngrok for local development:

1. **Install ngrok:**

```bash
npm install -g ngrok
# or
brew install ngrok  # macOS
```

2. **Sign up for ngrok account** (free) at [ngrok.com](https://ngrok.com)

3. **Authenticate ngrok:**

```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

4. **Start your development server:**

```bash
npm run dev
```

5. **In a separate terminal, start ngrok:**

```bash
ngrok http 3000
```

6. **Copy the HTTPS URL** (e.g., `https://abc123.ngrok-free.app`)

7. **Update your environment variables:**

```env
BETTER_AUTH_URL="https://abc123.ngrok-free.app"
NEXT_PUBLIC_APP_URL="https://abc123.ngrok-free.app"
```

8. **Set this URL in BotFather:**
   - Send `/setdomain` to @BotFather
   - Select your bot
   - Enter your ngrok URL (without `https://`)

9. **Restart your dev server** to pick up the new environment variables

## Verification

To verify your installation is working:

1. Visit your app at the ngrok URL (or your production domain)
2. You should see the Telegram login widget on your login page
3. Click the widget and authenticate with Telegram
4. You should be redirected back and logged in

## Troubleshooting

### Widget doesn't appear

- Check that the container element exists in the DOM
- Verify the bot username is correct (without @)
- Make sure you've set the domain in BotFather
- Check browser console for errors

### Authentication fails

- Verify environment variables are set correctly
- Check that the bot token is valid
- Ensure the domain matches what's set in BotFather
- Check that your database migrations ran successfully

### ngrok URL changes

ngrok free tier generates a new URL each time. To keep a persistent URL:
- Upgrade to ngrok paid plan for a static domain, or
- Use a service like localtunnel as an alternative, or
- Deploy to a staging environment (Vercel, Netlify, etc.)

## Next Steps

- [Usage Examples](./usage.md)
- [API Reference](./api-reference.md)
- [Configuration Options](./configuration.md)
- [Security Best Practices](./security.md)

## Getting Help

- [GitHub Issues](https://github.com/vcode-sh/better-auth-telegram/issues)
- [Better Auth Documentation](https://better-auth.com)
- Email: [hello@vcode.sh](mailto:hello@vcode.sh)
