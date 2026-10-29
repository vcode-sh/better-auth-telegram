// Compiled against the built package (dist/) by `npm run test:types`.
import { betterAuth } from "better-auth";
import { createAuthClient } from "better-auth/client";
import { type TelegramOIDCClaims, telegram } from "better-auth-telegram";
import { telegramClient } from "better-auth-telegram/client";

type IsAny<T> = 0 extends 1 & T ? true : false;
/** Fails to compile when T resolved to `any` (i.e. a type did not resolve). */
function typed<T>(_value: T, ..._check: IsAny<T> extends true ? [never] : []) {
  return _value;
}

const auth = betterAuth({
  plugins: [
    telegram({ botToken: "1:x", botUsername: "bot", oidc: { enabled: true } }),
  ],
});

// Server endpoints are typed (optional because flows can be disabled).
typed(auth.api.signInWithTelegram);
typed(auth.api.signInWithMiniApp);
export const signInPath = auth.api.signInWithTelegram?.path satisfies
  | "/telegram/signin"
  | undefined;

// The module augmentation types getPlugin("telegram").
export async function pluginRegistry() {
  const ctx = await auth.$context;
  const plugin = typed(ctx.getPlugin("telegram"));
  return plugin?.id satisfies "telegram" | undefined;
}

// Client actions are typed.
const client = createAuthClient({ plugins: [telegramClient()] });
typed(client.signInWithTelegram);
typed(client.signInWithTelegramOIDC);

// Telegram sends the user id as a string (a number would lose precision).
export const id: TelegramOIDCClaims["id"] = "8306595751";
// @ts-expect-error the id claim is a string, never a number
export const numericId: TelegramOIDCClaims["id"] = 8306595751;
