# OIDC: Log In With Telegram

OIDC (OpenID Connect) is the standard "Sign in with..." flow that Google, Apple and others use. Telegram calls its version **Log In With Telegram**. Your user clicks a button, goes to Telegram's login page at `oauth.telegram.org`, confirms in the Telegram app, and comes back to your site signed in.

Choose OIDC when your app is a website and you want a standard OAuth 2.0 flow, or the user's phone number. For a quick button on a website, the [Login Widget](./usage.md) needs less setup; inside Telegram, use a [Mini App](./miniapps.md).

## Contents

- [How it works](#how-it-works)
- [Setup](#setup)
- [Add the sign-in button](#add-the-sign-in-button)
- [What gets stored](#what-gets-stored)
- [Phone numbers](#phone-numbers)
- [Link Telegram OIDC to a signed-in user](#link-telegram-oidc-to-a-signed-in-user)
- [Only allow existing users](#only-allow-existing-users)
- [Sign in with an ID token you already have](#sign-in-with-an-id-token-you-already-have)
- [Things to know about Telegram's OIDC](#things-to-know-about-telegrams-oidc)
- [Known limitations](#known-limitations)

## How it works

1. The user clicks your button. Your client calls Better Auth's `/sign-in/social` with the provider `telegram-oidc`.
2. The browser goes to `oauth.telegram.org`. The user picks their Telegram account and confirms the sign-in in the Telegram app.
3. Telegram sends the browser back to `https://<your domain>/api/auth/callback/telegram-oidc` with a one-time code.
4. Your server exchanges the code for an **ID token**, a signed message describing the user. The plugin checks the signature, the issuer, the audience, the expiry and a one-time value called the nonce, and only then reads the user's details.
5. Better Auth finds or creates the user, starts a session and sends the browser to your `callbackURL`.

The plugin adds a provider called `telegram-oidc` to Better Auth's built-in social sign-in. It doesn't add OIDC endpoints of its own; PKCE, the `state` check and the callback are Better Auth's standard machinery.

## Setup

### 1. Configure the bot in BotFather

Follow [Telegram bot setup: OIDC](./telegram-bot-setup.md#oidc). In short: switch the bot to OpenID Connect, register `https://<your domain>/api/auth/callback/telegram-oidc` as a redirect URI, and copy the **Client ID** and **Client Secret**.

> **Remember the two-bot rule.** Switching a bot to OpenID Connect permanently turns off its legacy Login Widget. If you also use the Login Widget, OIDC needs its own bot.

### 2. Configure the server

**OIDC only:**

```ts
// auth.ts
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: new DatabaseSync("./sqlite.db"),
  plugins: [
    telegram({
      loginWidget: false,
      oidc: {
        enabled: true,
        clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
        clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
      },
    }),
  ],
});
```

**OIDC together with the Login Widget** (two bots):

```ts
// auth.ts
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: new DatabaseSync("./sqlite.db"),
  plugins: [
    telegram({
      // Bot A: Login Widget (and Mini App, if you enable it)
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
      // Bot B: switched to OpenID Connect in BotFather
      oidc: {
        enabled: true,
        clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
        clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
      },
    }),
  ],
});
```

`clientSecret` is **required**, and it is the Client Secret from BotFather, **not** the bot token. Without it, the plugin warns at startup and every OIDC sign-in fails with 500 `OIDC_CLIENT_SECRET_REQUIRED`. If you leave out `clientId`, the plugin uses the bot ID from `botToken`.

All OIDC options are in [Configuration: OIDC](./configuration.md#oidc-options).

### 3. Update the database

Run `npx auth@latest migrate` (or `generate` for Prisma and Drizzle), then `npx auth@latest check schema`, as in [Installation](./installation.md#3-update-your-database). An OIDC-only setup adds no columns of its own, but Better Auth's own tables must exist.

## Add the sign-in button

```ts
// telegram-oidc-button.ts
import { authClient } from "./auth-client";

export async function signInWithTelegram() {
  const { error } = await authClient.signInWithTelegramOIDC({
    callbackURL: "/dashboard", // where to go after signing in
    errorCallbackURL: "/login", // where to go if sign-in fails
  });
  if (error) {
    console.error("Could not start Telegram sign-in:", error.message);
  }
}
```

Call it from a click handler, for example `<button onClick={signInWithTelegram}>Sign in with Telegram</button>` in React. The browser leaves your page; there is no widget script and nothing to clean up.

If something fails after Telegram, Better Auth sends the browser to `errorCallbackURL` (or its own error page) with `?error=<code>` in the URL. The codes are explained in [Troubleshooting: OIDC](./troubleshooting.md#oidc).

`signInWithTelegramOIDC` is a shortcut for Better Auth's `signIn.social`. Use `signIn.social` directly when you need its other options, such as a separate page for new users:

```ts
import { authClient } from "./auth-client";

export async function signInWithTelegramWelcome() {
  await authClient.signIn.social({
    provider: "telegram-oidc",
    callbackURL: "/dashboard",
    newUserCallbackURL: "/welcome",
  });
}
```

## What gets stored

A new OIDC user gets:

- **name**: the `name` claim, or given name + family name, or the username.
- **image**: the `picture` claim (Telegram profile photo URL).
- **email**: the placeholder `<sub>@telegram-oidc.placeholder.invalid`, unverified ([why](./installation.md#placeholder-emails)).
- an **account** with provider ID `telegram-oidc` and account ID `sub`.

When the Login Widget or Mini App is also enabled, the Telegram columns exist and the plugin copies more details from the verified ID token after each OIDC sign-up, sign-in and link:

| ID token claim | Copied to |
|---|---|
| `id` (the Telegram user ID) | `user.telegramId` and `account.telegramId` |
| `preferred_username` | `user.telegramUsername` and `account.telegramUsername` (cleared when the user removes their Telegram username) |
| `phone_number` (with `requestPhone`) | `user.telegramPhoneNumber` |

This is what lets someone who signed up with OIDC later sign in with the Login Widget or a Mini App and land in the same account: those methods find users by `user.telegramId`.

Safety rules: the details only go to the user who owns the `telegram-oidc` account for that token's `sub`. The plugin never overwrites a different `telegramId` already on the user, and never copies a Telegram ID that another user already has (it logs a warning instead).

In OIDC-only mode there are no Telegram columns, so nothing is copied.

**Changing the stored values.** `mapOIDCProfileToUser` receives the verified claims and can change `name`, `image` and `email` for new users:

```ts
import { telegram } from "better-auth-telegram";

export const telegramPlugin = telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
    mapOIDCProfileToUser: (claims) => ({
      name: claims.preferred_username ?? claims.name,
    }),
  },
});
```

The result is merged over the defaults above, and any `id` it returns is ignored. Returning `telegramId` or `telegramPhoneNumber` does nothing (Better Auth drops those fields because users may not set them); the plugin fills them itself. Don't return `emailVerified: true`: Telegram never verifies an email address, and Better Auth would trust it, for example when deciding whether to link the sign-in to an existing user with the same email.

## Phone numbers

Set `requestPhone: true` to ask for the user's phone number:

```ts
import { telegram } from "better-auth-telegram";

export const telegramPlugin = telegram({
  // One bot for the Mini App and OIDC. The Mini App gives you the Telegram columns.
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  loginWidget: false,
  miniApp: { enabled: true },
  oidc: {
    enabled: true,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
    requestPhone: true,
  },
});
```

What to expect:

- Telegram shows the user a **separate consent dialog** for the phone number.
- The number arrives as **digits only, without `+`**, for example `971577777777`.
- It is stored in `user.telegramPhoneNumber`, which only exists when the Login Widget or Mini App is enabled. In OIDC-only mode the plugin warns at startup that the number won't be stored. If you need it there, read `claims.phone_number` in `mapOIDCProfileToUser` and return it in a field of your own (declared in Better Auth's `user.additionalFields`).
- If a later sign-in brings no phone number, the stored one is kept.
- We have not verified what Telegram sends when a user declines only the phone dialog.

Similarly, `requestBotAccess: true` asks the user to let your bot send them direct messages (Telegram's `telegram:bot_access` scope).

## Link Telegram OIDC to a signed-in user

A signed-in user can add Telegram OIDC as another sign-in method with Better Auth's `linkSocial`:

```ts
import { authClient } from "./auth-client";

export async function linkTelegramOIDC() {
  await authClient.linkSocial({
    provider: "telegram-oidc",
    callbackURL: "/settings",
  });
}
```

Better Auth only links an OAuth account when the provider confirms the email, or when you trust the provider, and only when the emails match unless you allow otherwise. Telegram has no email, so you must allow both:

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  account: {
    accountLinking: {
      trustedProviders: ["telegram-oidc"],
      allowDifferentEmails: true,
    },
  },
  plugins: [
    telegram({
      loginWidget: false,
      oidc: {
        enabled: true,
        clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
        clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
      },
    }),
  ],
});
```

Without these, the link fails and Better Auth redirects with `error=unable_to_link_account` or `error=email_does_not_match`. A trusted provider also lets Better Auth link a sign-in to an existing user with the same email. With the placeholder email that can't match anyone else; if your `mapOIDCProfileToUser` returns real emails, keep that in mind.

## Only allow existing users

`oidc.disableSignUp: true` lets existing users sign in with Telegram OIDC but never creates a new user. A Telegram user without an account is sent to your error page with `error=signup_disabled`.

## Sign in with an ID token you already have

If your app already has a Telegram ID token (for example from Telegram's own login library or a native app), you can send it to Better Auth's ID-token sign-in:

```ts
import { authClient } from "./auth-client";

export async function signInWithIdToken(token: string, nonce: string) {
  return await authClient.signIn.social({
    provider: "telegram-oidc",
    idToken: { token, nonce },
  });
}
```

The plugin checks the token exactly like in the redirect flow, and it **requires the `nonce`** the token carries (Better Auth itself treats the nonce as optional). Forged, expired, nonce-less or mismatched tokens get 401.

> **This is not replay protection.** The nonce comes from the request and is also inside the token, so anyone who captures a token can send it again until it expires: Telegram's 30-second lifetime plus 30 seconds of clock tolerance, so up to about a minute. Requiring the nonce only refuses tokens that were issued without one. In the redirect flow it's different: Better Auth creates the nonce on the server and ties it to that one sign-in.

This path is on by default, as for Better Auth's built-in providers. If you don't use it, turn it off with `oidc.disableIdTokenSignIn: true`. ID tokens sent to `/sign-in/social` or `/link-social` are then rejected with 404 `ID_TOKEN_NOT_SUPPORTED`, and only the redirect flow remains.

## Things to know about Telegram's OIDC

These come from Telegram's documentation and from testing against the live service on 2026-10-29. Where the two differ, the live behavior is noted.

- **`sub` is not the Telegram user ID, and it is different for each bot.** The same person gets another `sub` from another bot (Telegram's discovery document says `public`, which would mean the same `sub` everywhere; live, it differs). The plugin stores OIDC accounts by `sub`, so changing the OIDC bot gives every user a new account. The real Telegram user ID is the `id` claim.
- **`id` arrives as a string**, for example `"8306595751"`, although Telegram's documentation shows a number. The plugin types it as `string`.
- **ID tokens live 30 seconds, and there is no refresh token.** There is also no UserInfo endpoint, so the access token is of no further use.
- **Token errors come back with HTTP 200** and an `error` field. The plugin treats them as failures; Better Auth then redirects with `error=invalid_code`.
- **Declining sends no callback.** If the user declines in the Telegram app, Telegram never redirects back to your site; the browser stays on `oauth.telegram.org`, which shows its account picker again. Don't build UI that waits for an "access denied" callback; keep a "Back" link on your own page instead.
- **The signing algorithm matters.** With EdDSA or ES256K (set in BotFather under Login Widget > Advanced), Telegram's docs say the `profile` and `phone` scopes are rejected. Live, the sign-in succeeds but the token contains no `id`, name, username or phone. The plugin logs a warning when `id` is missing. ES256K tokens can't be verified at all (Web Crypto doesn't support that curve). Use RS256 (the default) or ES256.
- **Signing key rotation.** When Telegram starts using a new signing key, sign-ins can fail for up to 30 seconds, until the plugin is allowed to download Telegram's key set again.

## Known limitations

- **OIDC doesn't find existing Login Widget or Mini App users yet** ([#25](https://github.com/vcode-sh/better-auth-telegram/issues/25)). Better Auth matches OAuth sign-ins by account ID and then by verified email, and a Login Widget user has neither. The other direction works (see [What gets stored](#what-gets-stored)). Until then, let signed-in users [link OIDC](#link-telegram-oidc-to-a-signed-in-user).
- **With Better Auth's `oauth-proxy` plugin**, the Telegram ID isn't copied onto the user: the token is checked on the server that exchanges the code, while the user is created on the other server.
- **Better Auth's `/account-info`** stops working for `telegram-oidc` about 30 seconds after sign-in, because the tokens expire and can't be refreshed. Read `telegramId`, `telegramUsername` and `telegramPhoneNumber` from the user instead.
- **With `session.cookieCache`**, Telegram fields changed by Better Auth's `/link-social` or `/unlink-account` show up in the session only when the cache expires. (The plugin's own `/telegram/link` and `/telegram/unlink` refresh the cookie immediately.)
- **Two-factor authentication is skipped**, as for Better Auth's other social sign-ins. See [Security: two-factor](./security.md#two-factor-authentication).
