"use client";

import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [telegramClient()],
});

export type { Session } from "./auth";
