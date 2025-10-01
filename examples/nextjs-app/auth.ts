// Server-side auth configuration
// app/lib/auth.ts

import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: {
    // Your database configuration
    provider: "postgresql",
    url: process.env.DATABASE_URL!,
  },

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
    }),
  ],
});
