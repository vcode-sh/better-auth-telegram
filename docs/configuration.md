# Configuration

Everything you can tweak, nothing you can't. No database adapters, no session philosophy, no framework tours -- that's [Better Auth's job](https://www.better-auth.com/docs). This page is strictly about what `better-auth-telegram` gives you to misconfigure.

## Server Configuration

### Login Widget Minimum

The default enables the Login Widget, so it needs the bot token and username when that flow is used.

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your database config */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,
    }),
  ],
});
```

### Full Options Reference

Every option, every default, no surprises (for once).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `botToken` | `string` | `undefined` | Required at runtime by enabled Login Widget and Mini App flows for HMAC verification. OIDC can use an explicit `oidc.clientId` and `oidc.clientSecret` instead. |
| `botUsername` | `string` | `undefined` | Required only when the Login Widget is rendered. Bot username without the `@`. |
| `allowUserToLink` | `boolean` | `true` | Let users link Telegram to an existing account. |
| `autoCreateUser` | `boolean` | `true` | Auto-create a user on first sign-in. Set to `false` if you enjoy gatekeeping. |
| `maxAuthAge` | `number` | `86400` | How many seconds old the auth data can be before we reject it. 86400 = 24 hours. Prevents replay attacks from time travellers. |
| `loginWidget` | `boolean` | `true` | Register the Login Widget endpoints (`/telegram/signin`, `/telegram/link`, `/telegram/unlink`). With `false` and no Mini App, the Telegram schema fields are omitted too. |
| `mapTelegramDataToUser` | `function` | see below | Custom mapping from Telegram data to your user object, merged over the defaults. |
| `miniApp` | `object` | see below | Mini App configuration. Disabled by default because not everyone lives inside Telegram. |
| `oidc` | `object` | see below | Telegram OIDC configuration. Also disabled by default. |
| `testMode` | `boolean` | `false` | Informational only: returned by `GET /telegram/config`, changes no verification or widget behavior. See [Test Server Mode](#test-server-mode). |

### Default User Mapping

By default, the plugin maps `first_name` + `last_name` to `name`. Not `username` -- actual human names. Radical concept.

```typescript
// What happens when you don't provide mapTelegramDataToUser
{
  name: data.last_name
    ? `${data.first_name} ${data.last_name}`
    : data.first_name,
  image: data.photo_url,
  email: `${data.id}@telegram.placeholder.invalid`,  // Telegram doesn't do email. Cope.
  emailVerified: false,
}
```

The placeholder exists because Better Auth's `user.email` is required and unique. `.invalid` is reserved by RFC 6761, so nothing is ever delivered there. Mini App users get the same treatment.

### Custom User Mapping

Customize with `mapTelegramDataToUser`. You get the raw `TelegramAuthData`; whatever you return is merged over the defaults above, so a mapper that only returns `name` keeps the default `image` and placeholder email:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  mapTelegramDataToUser: (data) => ({
    name: data.username || data.first_name,
    // Throw in whatever custom fields your schema supports
    authenticatedVia: "telegram",
  }),
})
```

The `data` parameter is a `TelegramAuthData` object: `id`, `first_name`, `last_name?`, `username?`, `photo_url?`, `auth_date`, `hash`.

The mapper's result only matters when a user is created (existing users aren't rewritten); the plugin itself sets `telegramId` and `telegramUsername`. Sign-ups go through Better Auth's internal adapter, so `databaseHooks` run (a hook that vetoes the user means 403 `USER_CREATION_REJECTED`). `user.validateUserInfo` sees `source.method` `"telegram-login-widget"` (or `"telegram-mini-app"`) with action `"create-user"` for sign-ups, `"sign-in"` for returning users, and `"link-account"` for links by `telegramId` and `/telegram/link`. A validator that throws fails closed: 403 `validation_failed`.

### Mini App Configuration

For when your app lives inside Telegram itself. Disabled by default.

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  miniApp: {
    enabled: true,
    validateInitData: true,
    allowAutoSignin: true,
    mapMiniAppDataToUser: (user) => ({
      name: user.username || user.first_name,
    }),
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Turn on Mini App endpoints (`/telegram/miniapp/signin`, `/telegram/miniapp/validate`). |
| `validateInitData` | `boolean` | `true` | Verify the HMAC signature on `initData`. With `false`, anyone can sign in as any Telegram user; the plugin logs a startup warning. Only for tests, or if you enjoy security incidents. |
| `allowAutoSignin` | `boolean` | `true` | Auto-create users from Mini App sign-ins. Works in tandem with `autoCreateUser` -- both must be `true` for new users to be created. |
| `mapMiniAppDataToUser` | `function` | same as login widget | Custom mapping from `TelegramMiniAppUser`, merged over the defaults. Gets `id`, `first_name`, `last_name?`, `username?`, `photo_url?`, `language_code?`, `is_premium?`, `is_bot?`, `allows_write_to_pm?`, `added_to_attachment_menu?`. |

### OIDC Configuration

Standard OAuth 2.0 Authorization Code flow with PKCE and a nonce via `oauth.telegram.org`. Phone numbers and JWKS-verified ID tokens without the legacy Widget callback. Disabled by default.

Get the Client ID and Client Secret from [@BotFather](https://t.me/botfather)'s mini app: **My bots > your bot > Login Widget > Switch to OpenID Connect Login**. That switch permanently disables the bot's legacy Login Widget, so if you also serve the widget, use a second bot for OIDC (the example below goes OIDC-only instead). Full walkthrough: [OIDC prerequisites](../README.md#prerequisites).

```typescript
telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
    requestPhone: true,        // get phone numbers via the `phone` scope
    requestBotAccess: false,   // request bot access via `telegram:bot_access` scope
    scopes: ["openid", "profile"],  // default scopes
    mapOIDCProfileToUser: (claims) => ({
      name: claims.preferred_username ?? claims.name,
    }),
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Turn on Telegram OIDC. Injects a `telegram-oidc` provider into Better Auth's social login system via the `init` hook. |
| `clientId` | `string` | bot ID from `botToken` | Client ID from BotFather > your bot > Login Widget (it's the bot's id). Required when `botToken` is omitted, and when the OIDC bot isn't the Login Widget bot. |
| `clientSecret` | `string` | none (required) | Client Secret from the same page. There is no bot-token fallback any more (Telegram never accepted it): startup warns and OIDC logins throw until it's set. |
| `disableIdTokenSignIn` | `boolean` | `false` | Reject client-submitted ID tokens (`POST /sign-in/social` or `/link-social` with `idToken`), leaving only the redirect flow. |
| `disableSignUp` | `boolean` | `false` | Only sign in existing users; never create a user from Telegram OIDC (Better Auth redirects with `error=signup_disabled`). |
| `overrideUserInfoOnSignIn` | `boolean` | `false` | Update the user's name and photo from the ID token on every sign-in, so Telegram profile changes show up. Leave it off if users can edit those fields in your app. |
| `scopes` | `string[]` | `["openid", "profile"]` | OIDC scopes to request. `openid` is always included regardless; `profile` only when you don't pass your own list. |
| `requestPhone` | `boolean` | `false` | Add the `phone` scope. When the Telegram columns exist, `phone_number` (digits only, no `+`) is copied to `user.telegramPhoneNumber`. |
| `requestBotAccess` | `boolean` | `false` | Add the `telegram:bot_access` scope. Lets your bot send messages to the user. |
| `mapOIDCProfileToUser` | `function` | `name` (or given + family name, or username), `picture`, placeholder email | Customize `name`, `email` and `image` from `TelegramOIDCClaims`; merged over the defaults. Any `id` it returns is ignored. Returning `telegramId` / `telegramPhoneNumber` does nothing: they're `input: false` and Better Auth drops them. |

OIDC uses Better Auth's built-in social login routes — no custom endpoints. The plugin injects a `telegram-oidc` provider via the `init` hook and Better Auth handles `POST /sign-in/social` and `GET /callback/telegram-oidc` automatically. HTTP Basic client authentication, the nonce and ID token verification are always on; there's nothing to configure. Client-submitted ID tokens are only accepted together with the `nonce` they were issued for, even though Better Auth itself treats it as optional.

When the Login Widget or Mini App is enabled (so the Telegram columns exist), the plugin copies the verified `id`, `preferred_username` and `phone_number` claims onto `user.telegramId`, `user.telegramUsername` and `user.telegramPhoneNumber` after an OIDC sign-in, sign-up or link, and stores `id` / `preferred_username` on the `telegram-oidc` account row too. Claims only apply to the user who owns the `telegram-oidc` account whose id is the token's `sub`. It never overwrites a different `telegramId` and never copies an id another user already has. When a Telegram account is removed, the plugin re-checks `user.telegramId` and clears (or switches) it if no remaining Telegram account proves it.

New OIDC users get the placeholder email `<sub>@telegram-oidc.placeholder.invalid` (v2 used `<sub>@telegram.oidc`; existing users keep what they have).

Missing flow credentials produce setup warnings instead of aborting application startup. The corresponding request still fails closed if the credential is missing when the flow is used. Two more startup warnings exist for configurations that are legal but probably wrong: `miniApp.validateInitData: false`, and Login Widget plus OIDC without an explicit `oidc.clientId` (one bot can't do both).

### Test Server Mode

Telegram runs a [test environment](https://core.telegram.org/bots/webapps#testing-mini-apps) -- separate bots, separate users, separate existential dread. `testMode: true` is purely informational: `GET /telegram/config` returns it so your client can tell which environment it's talking to. It doesn't touch verification or the widget. HMAC verification only depends on the bot token, so a test-environment token just works, and Telegram documents no test variant of the Login Widget or of OIDC.

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,   // test env token
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  testMode: true,
})
```

If you enable both `testMode` and `oidc`, the plugin logs a `console.warn`: `oauth.telegram.org` has no documented test variant, so OIDC may not play nicely with test-environment bots. You've been warned.

### Lockdown Mode

For the paranoid (read: responsible):

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  autoCreateUser: false,     // No new users. Invite only vibes.
  allowUserToLink: false,    // No linking. One identity, one account.
  maxAuthAge: 3600,          // 1 hour. Paranoia pays off.
})
```

## Client Configuration

### Setup

`telegramClient()` takes zero arguments. It just works. A concept lost on most SDKs.

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  plugins: [telegramClient()],
});
```

### Widget Options

When you call `initTelegramWidget`, the second argument is `TelegramWidgetOptions`:

```typescript
authClient.initTelegramWidget(
  "container-id",
  {
    size: "large",          // "large" | "medium" | "small"
    showUserPhoto: true,    // Show the user's profile pic on the button
    cornerRadius: 20,       // Border radius in pixels (0-20)
    requestAccess: false,   // Request write access to the user's DMs
    lang: "en",             // Language code -- "en", "ru", "pl", "es", etc.
  },
  async (data) => {
    await authClient.signInWithTelegram(data);
  }
);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `size` | `"large" \| "medium" \| "small"` | `"large"` | Button size. |
| `showUserPhoto` | `boolean` | `true` | Display the user's profile photo on the button. |
| `cornerRadius` | `number` | `20` | Border radius in pixels. Range: 0-20. |
| `requestAccess` | `boolean` | `false` | Request permission to DM the user. |
| `lang` | `string` | browser default | Widget language code. |

## Environment Variables

The only env vars this plugin cares about:

```env
TELEGRAM_BOT_TOKEN="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
TELEGRAM_BOT_USERNAME="your_bot_username"

# Only with OIDC (BotFather > your bot > Login Widget)
TELEGRAM_OIDC_CLIENT_ID="1234567890"
TELEGRAM_OIDC_CLIENT_SECRET="..."
```

Everything else -- `BETTER_AUTH_SECRET`, `DATABASE_URL`, your existential dread -- is between you and Better Auth.

Get the bot token from [@BotFather](https://t.me/BotFather). The username is whatever you named your bot, minus the `@`.

## Next Steps

- [API Reference](./api-reference.md) -- every endpoint, spelled out
- [Mini Apps Guide](./miniapps.md) -- building inside Telegram
- [Security](./security.md) -- the part you should actually read
- [Troubleshooting](./troubleshooting.md) -- when it all goes sideways
