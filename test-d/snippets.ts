// Documented client snippets, compiled against dist/ by `npm run test:types`.
// Keep in sync with README.md "Error Handling" and docs/usage.md.
import { createAuthClient } from "better-auth/client";
import type { TelegramAuthData } from "better-auth-telegram";
import {
  TELEGRAM_ERROR_CODES,
  telegramClient,
} from "better-auth-telegram/client";

const authClient = createAuthClient({ plugins: [telegramClient()] });

// README.md "Error Handling"
export async function readmeErrorHandling() {
  const { error } = await authClient.unlinkTelegram();
  if (error?.code === TELEGRAM_ERROR_CODES.CANNOT_UNLINK_LAST_ACCOUNT.code) {
    // tell the user to add another sign-in method first
  }
}

// docs/usage.md "Unlink Telegram Account"
export async function usageUnlink() {
  const result = await authClient.unlinkTelegram();

  if (result.error?.code === "CANNOT_UNLINK_LAST_ACCOUNT") {
    console.error("Add another way to sign in first.");
  } else if (result.error?.code === "SESSION_NOT_FRESH") {
    console.error("Sign in again, then unlink.");
  } else if (result.error) {
    console.error("Unlink failed:", result.error.message);
  } else {
    console.log("Telegram unlinked. Freedom.");
  }
}

// docs/usage.md "Sign In": the signed-in user, with the Telegram fields.
export async function usageSignIn(authData: TelegramAuthData) {
  const result = await authClient.signInWithTelegram(authData);
  if (result.error) {
    console.error(result.error.status, result.error.code, result.error.message);
    return;
  }
  const telegramId: string | null | undefined = result.data.user.telegramId;
  return telegramId;
}
