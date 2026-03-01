# Configuration

Everything you can tweak, nothing you can't. No database adapters, no session philosophy, no framework tours -- that's [Better Auth's job](https://www.better-auth.com/docs). This page is strictly about what `better-auth-telegram` gives you to misconfigure.

## Server Configuration

### The Bare Minimum

Two strings. That's it. Revolutionary.

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
| `botToken` | `string` | **required** | Bot token from @BotFather. The one secret you actually need to keep secret. |
| `botUsername` | `string` | **required** | Bot username without the `@`. Yes, without it. |
| `allowUserToLink` | `boolean` | `true` | Let users link Telegram to an existing account. |
| `autoCreateUser` | `boolean` | `true` | Auto-create a user on first sign-in. Set to `false` if you enjoy gatekeeping. |
| `maxAuthAge` | `number` | `86400` | How many seconds old the auth data can be before we reject it. 86400 = 24 hours. Prevents replay attacks from time travellers. |
| `mapTelegramDataToUser` | `function` | see below | Custom mapping from Telegram data to your user object. |
| `miniApp` | `object` | see below | Mini App configuration. Disabled by default because not everyone lives inside Telegram. |
| `oidc` | `object` | see below | Telegram OIDC configuration. Also disabled by default. |
| `testMode` | `boolean` | `false` | Enable Telegram test server mode. The widget uses the test environment; HMAC verification stays the same. See [Test Server Mode](#test-server-mode). |

### Default User Mapping

By default, the plugin maps `first_name` + `last_name` to `name`. Not `username` -- actual human names. Radical concept.

```typescript
// What happens when you don't provide mapTelegramDataToUser
{
  name: data.last_name
    ? `${data.first_name} ${data.last_name}`
    : data.first_name,
  image: data.photo_url,
  email: undefined,  // Telegram doesn't do email. Cope.
}
```

### Custom User Mapping

Override the default with `mapTelegramDataToUser`. You get the raw `TelegramAuthData` and return whatever you want:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  mapTelegramDataToUser: (data) => ({
    name: data.username || data.first_name,
    image: data.photo_url,
    email: undefined,
    // Throw in whatever custom fields your schema supports
    metadata: {
      telegramId: data.id.toString(),
      authenticatedVia: "telegram",
    },
  }),
})
```

The `data` parameter is a `TelegramAuthData` object: `id`, `first_name`, `last_name?`, `username?`, `photo_url?`, `auth_date`, `hash`.

### Mini App Configuration

For when your app lives inside Telegram itself. Disabled by default.

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  miniApp: {
    enabled: true,
    validateInitData: true,
    allowAutoSignin: true,
    mapMiniAppDataToUser: (user) => ({
      name: `${user.first_name} ${user.last_name || ""}`.trim(),
      image: user.photo_url,
      email: undefined,
    }),
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Turn on Mini App endpoints (`/telegram/miniapp/signin`, `/telegram/miniapp/validate`). |
| `validateInitData` | `boolean` | `true` | Verify the HMAC signature on `initData`. Only set to `false` if you enjoy security incidents. |
| `allowAutoSignin` | `boolean` | `true` | Auto-create users from Mini App sign-ins. Works in tandem with `autoCreateUser` -- both must be `true` for new users to be created. |
| `mapMiniAppDataToUser` | `function` | same as login widget | Custom mapping from `TelegramMiniAppUser` to your user object. Gets `id`, `first_name`, `last_name?`, `username?`, `photo_url?`, `language_code?`, `is_premium?`, `allows_write_to_pm?`. |

### OIDC Configuration

Standard OAuth 2.0 Authorization Code flow with PKCE via `oauth.telegram.org`. Phone numbers, RS256 JWT verification, proper grown-up auth. Disabled by default because not everyone needs the full federation experience.

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  oidc: {
    enabled: true,
    requestPhone: true,        // get phone numbers via the `phone` scope
    requestBotAccess: false,   // request bot access via `telegram:bot_access` scope
    scopes: ["openid", "profile"],  // default scopes
    mapOIDCProfileToUser: (claims) => ({
      name: `${claims.name}`,
      image: claims.picture,
    }),
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Turn on Telegram OIDC. Injects a `telegram-oidc` provider into Better Auth's social login system via the `init` hook. |
| `scopes` | `string[]` | `["openid", "profile"]` | OIDC scopes to request. `openid` is always included regardless. |
| `requestPhone` | `boolean` | `false` | Add the `phone` scope. Gets you `telegramPhoneNumber` on the user record. The Login Widget never could. |
| `requestBotAccess` | `boolean` | `false` | Add the `telegram:bot_access` scope. Lets your bot send messages to the user. |
| `mapOIDCProfileToUser` | `function` | uses `name` + `picture` from claims | Custom mapping from `TelegramOIDCClaims` to your user object. Gets `sub`, `name`, `preferred_username`, `picture`, `phone_number`. |

OIDC uses Better Auth's built-in social login routes — no custom endpoints. The plugin injects a `telegram-oidc` provider via the `init` hook and Better Auth handles `POST /sign-in/social` and `GET /callback/telegram-oidc` automatically.

### Test Server Mode

Telegram runs a [test environment](https://core.telegram.org/bots/webapps#testing-mini-apps) -- separate bots, separate users, separate existential dread. Set `testMode: true` and the client widget will point at the test server. HMAC verification is identical; only the bot token differs (you get a test token from @BotFather's test environment).

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,   // test env token
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  testMode: true,
})
```

One catch: Telegram's OIDC endpoint (`oauth.telegram.org`) has no documented test variant. If you enable both `testMode` and `oidc`, the plugin logs a `console.warn` to let you know you're on your own. OIDC may not play nicely with test server bot tokens. You've been warned.

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
```

Everything else -- `BETTER_AUTH_SECRET`, `DATABASE_URL`, your existential dread -- is between you and Better Auth.

Get the bot token from [@BotFather](https://t.me/BotFather). The username is whatever you named your bot, minus the `@`.

## Next Steps

- [API Reference](./api-reference.md) -- every endpoint, spelled out
- [Mini Apps Guide](./miniapps.md) -- building inside Telegram
- [Security](./security.md) -- the part you should actually read
- [Troubleshooting](./troubleshooting.md) -- when it all goes sideways
