# Configuration

Every option of the plugin, with its default, plus the Better Auth options that change how the plugin behaves. For setup steps, see [Installation](./installation.md).

## Contents

- [Starting points](#starting-points)
- [Plugin options](#plugin-options)
- [Mini App options](#mini-app-options)
- [OIDC options](#oidc-options)
- [Custom user data](#custom-user-data)
- [Better Auth options that affect Telegram sign-in](#better-auth-options-that-affect-telegram-sign-in)
- [Startup warnings](#startup-warnings)
- [Client configuration](#client-configuration)
- [Environment variables](#environment-variables)

## Starting points

Copy the one closest to your setup. Each goes into `plugins: [...]` of `betterAuth()`.

```ts
import { telegram } from "better-auth-telegram";

// Login Widget only
export const loginWidgetOnly = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
});

// Mini App only
export const miniAppOnly = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  loginWidget: false,
  miniApp: { enabled: true },
});

// OIDC only
export const oidcOnly = telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
  },
});

// Everything: bot A for the widget and Mini App, bot B for OIDC
export const everything = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  miniApp: { enabled: true },
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
  },
});
```

Why two bots in the last one: see [the two-bot rule](./telegram-bot-setup.md#using-more-than-one-method).

**Invite-only.** Existing users can sign in with Telegram, but nobody new is created and nobody can link a new Telegram account:

```ts
import { telegram } from "better-auth-telegram";

export const inviteOnly = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  autoCreateUser: false, // no new users from the Login Widget or Mini App
  allowUserToLink: false, // no linking of new Telegram accounts
  maxAuthAge: 3600, // accept sign-in data for 1 hour instead of 24
});
```

For OIDC, the matching switch is `oidc.disableSignUp: true`.

## Plugin options

| Option | Type | Default | What it does |
|---|---|---|---|
| `botToken` | `string` | none | The bot token from BotFather. Needed for the Login Widget and the Mini App, which use it to check Telegram's signature. Without it, those endpoints answer 500 `BOT_TOKEN_REQUIRED`. Also provides the default OIDC client ID. Spaces and newlines around it are removed (with a warning). |
| `botUsername` | `string` | none | The bot's username, without `@` (a leading `@` is removed, with a warning). Needed to show the Login Widget. |
| `loginWidget` | `boolean` | `true` | Turns on the Login Widget endpoints (`/telegram/signin`, `/telegram/link`, `/telegram/unlink`). Set `false` if you don't use the widget. With `false` and no Mini App, the plugin adds no database columns. |
| `autoCreateUser` | `boolean` | `true` | Create a new user when someone signs in with the Login Widget or Mini App for the first time. With `false`, unknown Telegram users get 404. Doesn't affect OIDC (use `oidc.disableSignUp`). |
| `allowUserToLink` | `boolean` | `true` | Let signed-in users link a Telegram account with `/telegram/link`. With `false`, linking answers 403 `LINKING_DISABLED`. |
| `maxAuthAge` | `number` (seconds) | `86400` (24 hours) | How old Login Widget data and Mini App `initData` may be. Older data is refused (401). Shorter is safer, see [Security](./security.md#replay-within-maxauthage). |
| `mapTelegramDataToUser` | function | none | Changes the data a new Login Widget user is created with. See [Custom user data](#custom-user-data). |
| `miniApp` | object | off | [Mini App options](#mini-app-options). |
| `oidc` | object | off | [OIDC options](#oidc-options). |
| `testMode` | `boolean` | `false` | A label only: `GET /telegram/config` returns it so your client knows it talks to Telegram's test environment. It changes no checks. |

## Mini App options

| Option | Type | Default | What it does |
|---|---|---|---|
| `miniApp.enabled` | `boolean` | `false` | Turns on `/telegram/miniapp/signin` and `/telegram/miniapp/validate`. |
| `miniApp.validateInitData` | `boolean` | `true` | Check the signature of `initData` on sign-in. **Keep it `true`.** With `false`, anyone can sign in as any Telegram user; the plugin logs a warning. Only for automated tests. (`/telegram/miniapp/validate` always checks.) |
| `miniApp.allowAutoSignin` | `boolean` | `true` | Allow Mini App sign-in to create new users. A new user is created only when this **and** `autoCreateUser` are `true`; otherwise the answer is 404 `MINI_APP_AUTO_SIGNIN_DISABLED`. |
| `miniApp.mapMiniAppDataToUser` | function | none | Changes the data a new Mini App user is created with. See [Custom user data](#custom-user-data). |

## OIDC options

| Option | Type | Default | What it does |
|---|---|---|---|
| `oidc.enabled` | `boolean` | `false` | Adds the `telegram-oidc` provider to Better Auth's social sign-in. |
| `oidc.clientId` | `string` | bot ID from `botToken` | The Client ID from BotFather (the OIDC bot's numeric ID). Set it whenever the OIDC bot is not the `botToken` bot, or there is no `botToken`. |
| `oidc.clientSecret` | `string` | none, **required** | The Client Secret from BotFather (bot > Login Widget). **Not the bot token.** Without it, OIDC sign-in answers 500 `OIDC_CLIENT_SECRET_REQUIRED`. |
| `oidc.scopes` | `string[]` | `[]` | Extra scopes, added to the defaults `openid` and `profile`. |
| `oidc.disableDefaultScope` | `boolean` | `false` | Don't request `profile` (`openid` is always sent). The ID token then has no Telegram ID, name or username, so `telegramId` is not stored. |
| `oidc.requestPhone` | `boolean` | `false` | Adds the `phone` scope. The number is stored in `user.telegramPhoneNumber` when that column exists (Login Widget or Mini App enabled). See [OIDC: phone numbers](./oidc.md#phone-numbers). |
| `oidc.requestBotAccess` | `boolean` | `false` | Adds the `telegram:bot_access` scope: asks the user to let your bot message them. |
| `oidc.disableSignUp` | `boolean` | `false` | Only existing users can sign in with OIDC; others are redirected with `error=signup_disabled`. |
| `oidc.disableIdTokenSignIn` | `boolean` | `false` | Refuse ID tokens sent directly to `/sign-in/social` and `/link-social`, leaving only the redirect flow. See [OIDC: ID tokens](./oidc.md#sign-in-with-an-id-token-you-already-have). |
| `oidc.mapOIDCProfileToUser` | function | none | Changes the data a new OIDC user is created with. See [Custom user data](#custom-user-data). |

## Custom user data

When a Telegram user signs up, the plugin creates the user with these values:

| Field | Login Widget and Mini App | OIDC |
|---|---|---|
| `name` | first name + last name | `name` claim, else given + family name, else username |
| `image` | Telegram photo URL | `picture` claim |
| `email` | `<telegram id>@telegram.placeholder.invalid` | `<sub>@telegram-oidc.placeholder.invalid` |
| `emailVerified` | `false` | `false` |

A mapper lets you change them. It receives Telegram's data and returns only what you want to change; the result is **merged over** the defaults:

```ts
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  user: {
    // A custom column must be declared here, or Better Auth drops it.
    additionalFields: {
      language: { type: "string", required: false },
    },
  },
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
      // Login Widget: data has id, first_name, last_name, username, photo_url, auth_date, hash
      mapTelegramDataToUser: (data) => ({
        name: data.username ?? data.first_name,
      }),
      miniApp: {
        enabled: true,
        // Mini App: user has id, first_name, last_name, username, language_code, is_premium, photo_url, ...
        mapMiniAppDataToUser: (user) => ({
          language: user.language_code,
        }),
      },
    }),
  ],
});
```

Rules, so there are no surprises:

- **Mappers run only when a user is created.** Existing users are not changed when they sign in again (except `telegramUsername`, which the plugin keeps current).
- **Only known fields are kept.** Mapper output is filtered like a Better Auth OAuth profile: fields that aren't in your user schema, or that users may not set (`input: false`), are dropped. That includes the plugin's own `telegramId`, `telegramUsername` and `telegramPhoneNumber`, which the plugin fills itself.
- **The Login Widget and Mini App mappers can't set `id` or `emailVerified`.** An email from a mapper is stored as unverified, because Telegram didn't verify it.
- **The OIDC mapper can't set `id` or `emailVerified`** (both are ignored). Telegram verifies no email, and Better Auth links a sign-in to an existing user when the email is marked verified, so a mapper must not be able to vouch for one.
- **An email that another user already has** is refused with 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`. The plugin never links the Telegram user to that other user.

## Better Auth options that affect Telegram sign-in

The plugin follows Better Auth's own settings, so these options apply to Telegram too:

| Better Auth option | Effect on Telegram sign-in |
|---|---|
| `trustedOrigins` | `/telegram/signin` and `/telegram/miniapp/signin` refuse browser requests from other origins with 403 `INVALID_ORIGIN`. Add the origin of every page that signs users in, if it differs from `BETTER_AUTH_URL`. |
| `account.accountLinking.enabled: false` | `/telegram/link` answers 403 `LINKING_DISABLED`, and a sign-in that would link itself to an existing user by `telegramId` answers 401 `ACCOUNT_NOT_LINKED`. |
| `account.accountLinking.disableImplicitLinking: true` | That automatic linking on sign-in answers 401 `ACCOUNT_NOT_LINKED`. Explicit `/telegram/link` still works. |
| `account.accountLinking.allowUnlinkingAll: true` | `/telegram/unlink` may remove a user's last sign-in method. |
| `account.accountLinking.trustedProviders`, `allowDifferentEmails` | Needed to link OIDC with `linkSocial`. See [OIDC: linking](./oidc.md#link-telegram-oidc-to-a-signed-in-user). |
| `session.freshAge` (default 1 day) | `/telegram/unlink` needs a session younger than this (403 `SESSION_NOT_FRESH`). |
| `databaseHooks` | Run for users, accounts and sessions created by Telegram sign-in. A hook that refuses a new user gives 403 `USER_CREATION_REJECTED`; one that refuses the session gives 401 `FAILED_TO_CREATE_SESSION`. |
| `user.validateUserInfo` | Called for every Login Widget and Mini App sign-up, sign-in and link, with `source.method` `"telegram-login-widget"` or `"telegram-mini-app"`. Details in [Security](./security.md#your-hooks-run-for-telegram-users). |
| `rateLimit` | Turns the plugin's rate limits on or off. Better Auth enables rate limiting in production only, by default. |
| `advanced.defaultCookieAttributes` | Needed for Mini Apps in Telegram Web. See [Mini Apps: cookies](./miniapps.md#inside-telegram-web-cookies-in-an-iframe). |

## Startup warnings

The plugin never stops your server for a configuration problem: secrets are sometimes loaded after startup. Instead it logs a warning through Better Auth's logger (lines start with `[better-auth-telegram]`), and the affected requests fail later with a clear error code.

| Warning about | Why it matters |
|---|---|
| Whitespace around `botToken` was removed | Often a newline from an env file. The plugin fixed it; fix your env file too. |
| `botToken` doesn't look like a bot token | Tokens look like `<digits>:<letters>`. A wrong value makes every Login Widget and Mini App sign-in fail with 401. |
| `botUsername` starts with `@` | The plugin removes the `@`. |
| `botToken` is missing | Login Widget and Mini App sign-in answer 500 `BOT_TOKEN_REQUIRED` until it's set. |
| `botUsername` is missing | The Login Widget can't be shown. Using only a Mini App or OIDC? Set `loginWidget: false`. |
| OIDC `clientId` is missing | No `oidc.clientId` and no `botToken`. OIDC sign-in fails with 500 `OIDC_CLIENT_ID_REQUIRED`. |
| OIDC `clientSecret` is missing | OIDC sign-in fails with 500 `OIDC_CLIENT_SECRET_REQUIRED`. |
| `miniApp.validateInitData` is `false` | Anyone can sign in as anyone. Never in production. |
| Login Widget and OIDC on the same bot | Switching a bot to OIDC disables its Login Widget. Use a second bot (`oidc.clientId`, `oidc.clientSecret`) or `loginWidget: false`. |
| `requestPhone` without the Telegram columns | OIDC-only mode has no `telegramPhoneNumber` column, so the number is not stored. |
| `testMode` together with OIDC | Telegram documents no test version of OIDC. |

Two more warnings can appear while running: an OIDC ID token without profile claims (the bot signs with EdDSA or ES256K, or `disableDefaultScope` is set), and an OIDC sign-in whose Telegram ID already belongs to another user (the ID is then not copied).

## Client configuration

`telegramClient()` takes no options:

```ts
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  plugins: [telegramClient()],
});
```

Widget appearance is set per call: see [Usage: widget options](./usage.md#widget-options).

## Environment variables

The plugin reads nothing from the environment by itself; you pass values in. The names used throughout these docs:

```bash
TELEGRAM_BOT_TOKEN="110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
TELEGRAM_BOT_USERNAME="my_app_login_bot"

# Only for OIDC (BotFather > your bot > Login Widget)
TELEGRAM_OIDC_CLIENT_ID="1234567890"
TELEGRAM_OIDC_CLIENT_SECRET="the Client Secret from BotFather"

# Better Auth's own
BETTER_AUTH_SECRET="output of: openssl rand -base64 32"
BETTER_AUTH_URL="https://example.com"
```
