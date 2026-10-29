// Server-side auth configuration
// app/lib/auth.ts

import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";
import { Pool } from "pg";

export const auth = betterAuth({
  // Better Auth's built-in Kysely adapter; run `npx auth@latest migrate`.
  database: new Pool({ connectionString: process.env.DATABASE_URL }),

  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,

      // Optional: custom user mapping
      mapTelegramDataToUser: (data) => ({
        name: data.username || data.first_name,
        image: data.photo_url,
      }),

      // Optional: configuration
      allowUserToLink: true,
      autoCreateUser: true,
      maxAuthAge: 86400, // 24 hours

      // Mini Apps — enable if you're building a Telegram Mini App
      miniApp: {
        enabled: true,
        validateInitData: true,
        allowAutoSignin: true,
      },

      // OIDC — OAuth 2.0 flow via oauth.telegram.org
      // Requires @BotFather > your bot > Login Widget > Switch to OpenID Connect.
      // That switch permanently disables the legacy widget, so this app uses a
      // SECOND bot for OIDC (or set loginWidget: false and use OIDC alone).
      oidc: {
        enabled: true,
        clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
        clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
        requestPhone: true,
      },
    }),
  ],
});
