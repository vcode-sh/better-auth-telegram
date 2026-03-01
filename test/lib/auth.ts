import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";
import { PrismaClient } from "@prisma/client";
import { prismaAdapter } from "better-auth/adapters/prisma";

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "sqlite",
  }),

  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")
    : [],

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

      // Mini Apps support
      miniApp: {
        enabled: true,
        validateInitData: true,
        allowAutoSignin: true,
        mapMiniAppDataToUser: (user) => ({
          name: user.username || user.first_name,
          image: user.photo_url,
          email: undefined,
        }),
      },

      // OIDC (OpenID Connect) support via oauth.telegram.org
      oidc: {
        enabled: true,
        requestPhone: true,
        requestBotAccess: true,
      },
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24h
  },
});

export type Session = typeof auth.$Infer.Session;
