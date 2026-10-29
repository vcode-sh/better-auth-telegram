# Telegram Mini Apps

A Mini App is your website, opened inside the Telegram app. When Telegram opens it, it passes along `initData`: a signed message saying which Telegram user opened the app. The plugin checks that signature and signs the user in. There is no login button and no password; the user is signed in as soon as the app opens.

## Contents

- [Setup](#setup)
- [Sign the user in](#sign-the-user-in)
- [How the user is found or created](#how-the-user-is-found-or-created)
- [Validate initData without signing in](#validate-initdata-without-signing-in)
- [Inside Telegram Web: cookies in an iframe](#inside-telegram-web-cookies-in-an-iframe)
- [Mini App on another domain than the auth server](#mini-app-on-another-domain-than-the-auth-server)
- [How the signature check works](#how-the-signature-check-works)
- [Troubleshooting](#troubleshooting)

## Setup

### 1. Turn on the Mini App in BotFather

Follow [Telegram bot setup: Mini App](./telegram-bot-setup.md#mini-app). You need your app's public HTTPS address; during development, a [tunnel](./installation.md#local-development-with-a-tunnel).

The Mini App must belong to the bot whose token is in `botToken`, because Telegram signs `initData` with that token. Switching a bot to OpenID Connect doesn't affect its Mini App.

### 2. Configure the server

```ts
// auth.ts
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: new DatabaseSync("./sqlite.db"),
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      loginWidget: false, // keep it on if your website also shows the Login Widget
      miniApp: { enabled: true },
    }),
  ],
});
```

Then update the database: `npx auth@latest migrate` (or `generate` for Prisma and Drizzle) and `npx auth@latest check schema`. The Mini App needs the [five Telegram columns](./installation.md#3-update-your-database).

Mini App options (all optional):

| Option | Default | What it does |
|---|---|---|
| `miniApp.enabled` | `false` | Turns on the Mini App endpoints. |
| `miniApp.validateInitData` | `true` | Checks the signature of `initData`. **Never turn this off in production**: with `false`, anyone can sign in as any Telegram user. The plugin logs a warning at startup. |
| `miniApp.allowAutoSignin` | `true` | Lets Mini App sign-in create new users. New users are created only when both this and `autoCreateUser` are `true`. |
| `miniApp.mapMiniAppDataToUser` | none | Changes the data a new user is created with. See [Configuration](./configuration.md#custom-user-data). |

### 3. Load Telegram's script

Add Telegram's Mini App script to your HTML `<head>`, before your other scripts, without `async` ([Telegram's instructions](https://core.telegram.org/bots/webapps#initializing-mini-apps)):

```html
<script src="https://telegram.org/js/telegram-web-app.js?64"></script>
```

It creates `window.Telegram.WebApp`, which holds `initData`.

## Sign the user in

With the client from [Installation](./installation.md#4-configure-the-client), one call does it:

```ts
// mini-app-sign-in.ts
import { authClient } from "./auth-client";

export async function signInInsideTelegram() {
  try {
    const { data, error } = await authClient.autoSignInFromMiniApp();
    if (error) {
      return `Sign-in failed: ${error.message}`;
    }
    return `Welcome, ${data.user.name}!`;
  } catch {
    // Thrown when the page isn't running inside Telegram
    return "Please open this app from Telegram.";
  }
}
```

`autoSignInFromMiniApp()` reads `window.Telegram.WebApp.initData`. If Telegram's script isn't there, it falls back to the `tgWebAppData` value Telegram puts in the URL fragment (`#tgWebAppData=...`). It then sends the value to your server, which checks it and starts a session. After success, `useSession()` updates by itself.

It **throws** (instead of returning an error) when neither source has data, which means the page was opened in a normal browser, or from a keyboard button or inline mode, where Telegram sends no `initData`.

To pass `initData` yourself, use `signInWithMiniApp`. TypeScript doesn't know about `window.Telegram`, so declare the part you use:

```ts
// mini-app-manual.ts
import { authClient } from "./auth-client";

declare global {
  interface Window {
    Telegram?: { WebApp: { initData: string; ready: () => void } };
  }
}

export async function signInManually() {
  const initData = window.Telegram?.WebApp.initData;
  if (!initData) {
    return null;
  }
  window.Telegram?.WebApp.ready(); // tells Telegram the app is ready to show
  return await authClient.signInWithMiniApp(initData);
}
```

In React, run the sign-in once in an effect. In development, React runs effects twice; that's fine, because the plugin handles two simultaneous sign-ins of the same user one after the other and creates the user only once.

## How the user is found or created

The signed-in user is always the person in `initData.user`, never the chat partner in `receiver`. The server looks for them in this order:

1. A Telegram account (provider `telegram`) with this Telegram ID: that user is signed in. Login Widget users and Mini App users with the same Telegram ID are the same user.
2. A user whose `telegramId` matches, for example someone who signed up with OIDC: the plugin links a `telegram` account to that user and signs them in. If Better Auth's `account.accountLinking.enabled` is `false` or `disableImplicitLinking` is `true`, this step is refused with 401 `ACCOUNT_NOT_LINKED` instead.
3. Nobody: a new user is created (if `autoCreateUser` and `miniApp.allowAutoSignin` allow it), with the name from first and last name, the Telegram photo, and a [placeholder email](./installation.md#placeholder-emails). Otherwise the answer is 404 `MINI_APP_AUTO_SIGNIN_DISABLED`.

Every sign-in also refreshes the stored `telegramUsername`. Users and accounts are written through Better Auth, so your `databaseHooks` and `user.validateUserInfo` run (with `source.method: "telegram-mini-app"`).

## Validate initData without signing in

`validateMiniApp` checks `initData` and returns the parsed data, without creating a session:

```ts
import { authClient } from "./auth-client";

export async function checkInitData(initData: string) {
  const { data } = await authClient.validateMiniApp(initData);
  if (data?.valid) {
    return data.data; // parsed initData: user, auth_date, start_param, ...
  }
  return null;
}
```

It always checks the signature, even if `miniApp.validateInitData` is `false`. An invalid or expired `initData` returns `{ valid: false, data: null }` with status 200.

## Inside Telegram Web: cookies in an iframe

Telegram's web clients (such as web.telegram.org) open Mini Apps in an **iframe**: "web MTProto clients that need to [...] open a bot mini app [...] in an iframe can use the postMessage API" ([Telegram: web events](https://core.telegram.org/api/web-events)). Inside that iframe your site is a third party, and browsers treat its cookies as third-party cookies. Better Auth's session cookie is `SameSite=Lax` by default, which browsers don't send in that situation, and Safari blocks third-party cookies entirely ([Better Auth: Safari and cross-domain setups](https://www.better-auth.com/docs/concepts/cookies#safari-itp-and-cross-domain-setups)).

The likely symptom: `autoSignInFromMiniApp()` succeeds, but the next request (for example `getSession()`) says nobody is signed in. We have not tested this live in web.telegram.org yet, so treat it as the likely cause, not a certainty.

Two ways around it:

**Option 1: cookie attributes for a cross-site iframe.** `sameSite: "none"` lets the browser send the cookie inside the iframe, `secure: true` is required with it, and `partitioned: true` keeps the cookie scoped to the Telegram site, which is what browsers that partition third-party cookies allow:

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  advanced: {
    defaultCookieAttributes: { sameSite: "none", secure: true, partitioned: true },
  },
  plugins: [
    telegram({ botToken: process.env.TELEGRAM_BOT_TOKEN, miniApp: { enabled: true } }),
  ],
});
```

`SameSite=None` gives up the browser's own protection against cross-site requests, so keep `trustedOrigins` short: Better Auth checks the origin of requests that carry cookies, and the plugin's sign-in endpoints check it even without cookies.

**Option 2: Better Auth's `bearer()` plugin.** Sign-in responses then include the session token in a `set-auth-token` header, and the client sends it as `Authorization: Bearer ...` instead of a cookie ([Bearer plugin](https://www.better-auth.com/docs/plugins/bearer)). It works with `/telegram/miniapp/signin` like with Better Auth's own sign-ins. Better Auth asks you to use it carefully: a token stored where JavaScript can read it is exposed to XSS.

Better Auth's `crossSubDomainCookies` option does **not** help here. It shares cookies between subdomains of one domain (like `app.example.com` and `api.example.com`), but the Telegram Web iframe is a different site altogether.

## Mini App on another domain than the auth server

If your Mini App is served from a different origin than Better Auth (for example the app at `https://app.example.com`, Better Auth at `https://api.example.com`), add the app's origin to `trustedOrigins`:

```ts
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  trustedOrigins: ["https://app.example.com"],
});
```

Otherwise `/telegram/miniapp/signin` answers 403 `INVALID_ORIGIN`. This protects against "login CSRF": without it, another website could send its own valid Telegram data to your server and sign your visitor into the wrong account. Also set `baseURL` in `createAuthClient` to the auth server, and allow the app's origin in your server's CORS settings.

## How the signature check works

You don't need this to use the plugin; it's here for the curious.

1. The server derives a secret key: `HMAC-SHA-256(key = "WebAppData", message = bot token)`.
2. It takes every field of `initData` except `hash` (including `signature`), sorts them by name and joins them as `key=value` lines. This is the "data-check-string".
3. It computes `HMAC-SHA-256(secret key, data-check-string)` and compares it with `hash` in constant time. `hash` must be 64 lowercase hex characters.
4. `auth_date` (when Telegram created the data) must be no older than `maxAuthAge` (default 24 hours) and no more than 60 seconds in the future.

`initData` also contains an Ed25519 `signature`, meant for third parties who don't have your bot token. The plugin has the token, so it doesn't use that check; the HMAC above already covers the `signature` field.

Within the `maxAuthAge` window, the same `initData` can be used again to sign in. See [Security: replay](./security.md#replay-within-maxauthage).

## Troubleshooting

**`autoSignInFromMiniApp()` throws "Not running in Telegram Mini App or initData not available".** The page was opened in a normal browser, or from a keyboard button or inline mode (Telegram sends no `initData` there). Open it from the bot's profile, the menu button, an inline button or a `t.me` link.

**`window.Telegram` is undefined.** Telegram's script isn't loaded. Add it to `<head>` as in [step 3](#3-load-telegrams-script). `autoSignInFromMiniApp()` can still read the URL fragment, but other Mini App features need the script.

**401 `INVALID_MINI_APP_INIT_DATA`.** The signature check failed. Check that `TELEGRAM_BOT_TOKEN` belongs to the bot that owns this Mini App, that `initData` is sent exactly as Telegram gave it (don't decode or rebuild it), that it's less than `maxAuthAge` old (reopen the Mini App if it has been open a long time), and that your server's clock is correct.

**404 `MINI_APP_AUTO_SIGNIN_DISABLED`.** This Telegram user has no account, and `autoCreateUser` or `miniApp.allowAutoSignin` is `false`.

**400 `NO_USER_IN_INIT_DATA`.** `initData` has no `user` field, so there is nobody to sign in.

**403 `INVALID_ORIGIN`.** See [Mini App on another domain](#mini-app-on-another-domain-than-the-auth-server).

**Signed in, but the next request is signed out (in Telegram Web).** See [cookies in an iframe](#inside-telegram-web-cookies-in-an-iframe).

**500 with "schema mismatch" in the server log.** The Telegram columns are missing. Run the [database step](./installation.md#3-update-your-database).

More in [Troubleshooting](./troubleshooting.md#mini-app).

## Resources

- [Telegram Mini Apps documentation](https://core.telegram.org/bots/webapps)
- [Validating data received via the Mini App](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
