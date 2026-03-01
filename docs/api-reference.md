# API Reference

Everything you never knew you needed to know about `better-auth-telegram`, laid out in excruciating detail so you can't blame the docs when your auth breaks at 3am.

## Table of Contents

- [Server Plugin](#server-plugin)
- [Client Plugin](#client-plugin)
- [Types](#types)
- [Endpoints](#endpoints)
- [Error Codes](#error-codes)
- [Rate Limits](#rate-limits)
- [Schema Extensions](#schema-extensions)
- [Verification (Internal)](#verification-internal)

---

## Server Plugin

### `telegram(options)`

The main server plugin function. Returns a `BetterAuthPlugin` object. If you forget `botToken`, it throws immediately -- no silent failures here.

```typescript
import { telegram } from "better-auth-telegram";

const plugin = telegram({
  botToken: "your-bot-token",
  botUsername: "your_bot",
  // ...options
});
```

#### Options: `TelegramPluginOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `botToken` | `string` | **required** | Bot token from @BotFather. The plugin throws if missing. |
| `botUsername` | `string` | **required** | Bot username without the `@`. Also throws if missing. |
| `allowUserToLink` | `boolean` | `true` | Allow authenticated users to link their Telegram account. |
| `autoCreateUser` | `boolean` | `true` | Auto-create a user when a new Telegram user signs in. |
| `maxAuthAge` | `number` | `86400` (24 hours) | Maximum age of `auth_date` in seconds. Prevents replay attacks. |
| `mapTelegramDataToUser` | `(data: TelegramAuthData) => UserData` | Uses `first_name`/`last_name` for name, `photo_url` for image | Custom mapping from Telegram data to your user object. |
| `miniApp` | `object` | `undefined` | Telegram Mini Apps configuration. See below. |
| `oidc` | `TelegramOIDCOptions` | `undefined` | Telegram OIDC configuration. See below. |
| `testMode` | `boolean` | `false` | Enable Telegram test server mode. Widget uses test environment; HMAC verification unchanged. |

##### `miniApp` Options

| Option | Type | Default | Description |
|---|---|---|---|
| `miniApp.enabled` | `boolean` | `false` | Enable Mini App endpoints. They literally don't exist until you flip this. |
| `miniApp.validateInitData` | `boolean` | `true` | Verify the HMAC signature of `initData`. Disable at your own risk. |
| `miniApp.allowAutoSignin` | `boolean` | `true` | Allow auto-creation of users from Mini App sign-in. |
| `miniApp.mapMiniAppDataToUser` | `(data: TelegramMiniAppUser) => UserData` | Uses `first_name`/`last_name` for name, `photo_url` for image | Custom mapping from Mini App user data. |

##### `oidc` Options

| Option | Type | Default | Description |
|---|---|---|---|
| `oidc.enabled` | `boolean` | `false` | Enable Telegram OIDC. Injects `telegram-oidc` social provider via the `init` hook. |
| `oidc.scopes` | `string[]` | `["openid", "profile"]` | OIDC scopes to request. |
| `oidc.requestPhone` | `boolean` | `false` | Add `phone` scope. Populates `telegramPhoneNumber` on the user record. |
| `oidc.requestBotAccess` | `boolean` | `false` | Add `telegram:bot_access` scope. |
| `oidc.mapOIDCProfileToUser` | `(claims: TelegramOIDCClaims) => UserData` | uses `name` + `picture` from claims | Custom mapping from OIDC claims. |

The `UserData` return type for all mapping functions:

```typescript
{
  name?: string;
  email?: string;
  image?: string;
  [key: string]: any;
}
```

#### Returns

A `BetterAuthPlugin` object with:

- `id`: `"telegram"`
- `init`: OIDC social provider injection (when `oidc.enabled`)
- `endpoints`: Authentication endpoints (4 base + 2 when Mini App is enabled)
- `schema`: Database schema extensions for `user` and `account` tables
- `rateLimit`: Per-endpoint rate limiting rules
- `$ERROR_CODES`: Error codes as `RawError` objects (exposed for programmatic access)

#### Module Augmentation

The plugin declares a `BetterAuthPluginRegistry` module augmentation on `@better-auth/core`, registering `telegram` as a known plugin. This means Better Auth's type system knows about the plugin's endpoints and error codes without you lifting a finger. TypeScript does the work for once.

```typescript
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    telegram: {
      creator: typeof telegram;
    };
  }
}
```

#### Example

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your adapter */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,
      autoCreateUser: true,
      allowUserToLink: true,
      maxAuthAge: 86400,
      miniApp: {
        enabled: true,
        validateInitData: true,
        allowAutoSignin: true,
      },
      oidc: {
        enabled: true,
        requestPhone: true,
      },
    }),
  ],
});
```

---

## Client Plugin

### `telegramClient()`

The browser-side plugin. Manages widget scripts, handles auth flows, and pretends the Telegram CDN is always reliable.

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [telegramClient()],
});
```

### Client Methods

All action methods accept an optional `fetchOptions?: Record<string, any>` parameter as their last argument for custom headers, cache control, credentials, etc.

---

#### `signInWithTelegram(authData, fetchOptions?)`

Sign in with data from the Telegram Login Widget.

```typescript
const result = await authClient.signInWithTelegram(authData);
```

| Parameter | Type | Description |
|---|---|---|
| `authData` | `TelegramAuthData` | Auth data from the Telegram widget |
| `fetchOptions` | `Record<string, any>` | Optional fetch customization |

**Returns:** The response from `POST /telegram/signin` containing `{ user, session }`.

---

#### `linkTelegram(authData, fetchOptions?)`

Link a Telegram account to the currently signed-in user.

```typescript
const result = await authClient.linkTelegram(authData);
```

| Parameter | Type | Description |
|---|---|---|
| `authData` | `TelegramAuthData` | Auth data from the Telegram widget |
| `fetchOptions` | `Record<string, any>` | Optional fetch customization |

**Returns:** `{ success: true, message: "Telegram account linked successfully" }` on success.

---

#### `unlinkTelegram(fetchOptions?)`

Unlink the Telegram account from the currently signed-in user.

```typescript
const result = await authClient.unlinkTelegram();
```

| Parameter | Type | Description |
|---|---|---|
| `fetchOptions` | `Record<string, any>` | Optional fetch customization |

**Returns:** `{ success: true, message: "Telegram account unlinked successfully" }` on success.

---

#### `getTelegramConfig(fetchOptions?)`

Fetch the bot configuration from the server.

```typescript
const config = await authClient.getTelegramConfig();
```

| Parameter | Type | Description |
|---|---|---|
| `fetchOptions` | `Record<string, any>` | Optional fetch customization |

**Returns:** `{ botUsername: string, miniAppEnabled: boolean, oidcEnabled: boolean, testMode: boolean }`

---

#### `initTelegramWidget(containerId, options?, onAuth)`

Render the Telegram Login Widget with a callback. Loads the widget script from `telegram.org`, fetches `botUsername` from your server, and injects the widget into your DOM. All automatic. You're welcome.

```typescript
await authClient.initTelegramWidget(
  "telegram-login-container",
  { size: "large", cornerRadius: 20 },
  async (authData) => {
    const result = await authClient.signInWithTelegram(authData);
  }
);
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `containerId` | `string` | **required** | HTML element ID for the widget |
| `options` | `TelegramWidgetOptions` | `{}` | Widget appearance options |
| `onAuth` | `(authData: TelegramAuthData) => void \| Promise<void>` | **required** | Callback when user authenticates |

**Returns:** `Promise<void>`

**Throws:** If the container element doesn't exist or the widget script fails to load.

---

#### `initTelegramWidgetRedirect(containerId, redirectUrl, options?)`

Render the Telegram Login Widget with redirect flow instead of a callback.

```typescript
await authClient.initTelegramWidgetRedirect(
  "telegram-login-container",
  "/auth/telegram/callback",
  { size: "medium" }
);
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `containerId` | `string` | **required** | HTML element ID for the widget |
| `redirectUrl` | `string` | **required** | URL to redirect after authentication |
| `options` | `TelegramWidgetOptions` | `{}` | Widget appearance options |

**Returns:** `Promise<void>`

**Throws:** If the container element doesn't exist or the widget script fails to load.

---

#### `signInWithMiniApp(initData, fetchOptions?)`

Sign in using raw `initData` from a Telegram Mini App. Only works when `miniApp.enabled` is `true` on the server.

```typescript
const initData = window.Telegram.WebApp.initData;
const result = await authClient.signInWithMiniApp(initData);
```

| Parameter | Type | Description |
|---|---|---|
| `initData` | `string` | Raw `initData` string from `Telegram.WebApp.initData` |
| `fetchOptions` | `Record<string, any>` | Optional fetch customization |

**Returns:** The response from `POST /telegram/miniapp/signin` containing `{ user, session }`.

---

#### `validateMiniApp(initData, fetchOptions?)`

Validate Mini App `initData` without signing in. Handy for checking if the data is legit before doing anything dramatic.

```typescript
const result = await authClient.validateMiniApp(initData);
if (result.data?.valid) {
  console.log("User:", result.data.data?.user);
}
```

| Parameter | Type | Description |
|---|---|---|
| `initData` | `string` | Raw `initData` string from `Telegram.WebApp.initData` |
| `fetchOptions` | `Record<string, any>` | Optional fetch customization |

**Returns:** `{ valid: boolean, data: TelegramMiniAppData | null }`

---

#### `autoSignInFromMiniApp(fetchOptions?)`

The lazy developer's dream. Automatically grabs `initData` from `window.Telegram.WebApp.initData` and signs in. Only works inside a Telegram Mini App -- throws if you try it in a regular browser.

```typescript
try {
  const result = await authClient.autoSignInFromMiniApp();
} catch (error) {
  // Not in a Mini App, or initData unavailable
}
```

| Parameter | Type | Description |
|---|---|---|
| `fetchOptions` | `Record<string, any>` | Optional fetch customization |

**Returns:** The response from `POST /telegram/miniapp/signin` containing `{ user, session }`.

**Throws:**
- `"This method can only be called in browser"` -- if `window` is undefined
- `"Not running in Telegram Mini App or initData not available"` -- if `Telegram.WebApp.initData` is missing

---

#### `signInWithTelegramOIDC(options?)`

Trigger the Telegram OIDC sign-in flow. Redirects to `oauth.telegram.org` for authentication, then back to your callback URL. Standard Better Auth social login under the hood — PKCE, state tokens, the works. Only works when `oidc.enabled` is `true` on the server.

```typescript
await authClient.signInWithTelegramOIDC({
  callbackURL: "/dashboard",
});
```

| Parameter | Type | Description |
|---|---|---|
| `options.callbackURL` | `string` | URL to redirect after authentication |

**Returns:** Redirects the browser. After callback, user has a session.

---

## Types

Every type this plugin exports, straight from the source. No creative liberties taken.

### `TelegramAuthData`

Data returned by the Telegram Login Widget.

```typescript
interface TelegramAuthData {
  auth_date: number;
  first_name: string;
  hash: string;
  id: number;
  last_name?: string;
  photo_url?: string;
  username?: string;
}
```

### `TelegramPluginOptions`

Server plugin configuration. See the [Server Plugin](#server-plugin) section for full details on each option.

```typescript
interface TelegramPluginOptions {
  allowUserToLink?: boolean;     // default: true
  autoCreateUser?: boolean;      // default: true
  botToken: string;              // required
  botUsername: string;            // required
  mapTelegramDataToUser?: (data: TelegramAuthData) => {
    name?: string;
    email?: string;
    image?: string;
    [key: string]: any;
  };
  maxAuthAge?: number;           // default: 86400
  miniApp?: {
    enabled?: boolean;           // default: false
    validateInitData?: boolean;  // default: true
    allowAutoSignin?: boolean;   // default: true
    mapMiniAppDataToUser?: (data: TelegramMiniAppUser) => {
      name?: string;
      email?: string;
      image?: string;
      [key: string]: any;
    };
  };
  oidc?: TelegramOIDCOptions;
  testMode?: boolean;              // default: false
}
```

### `TelegramOIDCOptions`

Configuration for the OIDC authentication flow.

```typescript
interface TelegramOIDCOptions {
  enabled?: boolean;             // default: false
  scopes?: string[];             // default: ["openid", "profile"]
  requestPhone?: boolean;        // default: false — adds "phone" scope
  requestBotAccess?: boolean;    // default: false — adds "telegram:bot_access" scope
  mapOIDCProfileToUser?: (claims: TelegramOIDCClaims) => {
    name?: string;
    email?: string;
    image?: string;
    [key: string]: any;
  };
}
```

### `TelegramOIDCClaims`

JWT ID token claims from Telegram OIDC. What you get back after the OAuth dance.

```typescript
interface TelegramOIDCClaims {
  aud: string;                   // bot ID (client_id)
  exp: number;                   // expiration timestamp
  iat: number;                   // issued at timestamp
  iss: string;                   // "https://oauth.telegram.org"
  sub: string;                   // Telegram user ID
  name?: string;                 // display name
  preferred_username?: string;   // Telegram username
  picture?: string;              // profile photo URL
  phone_number?: string;         // only with "phone" scope
}
```

### `TelegramMiniAppUser`

User object from Telegram Mini Apps `initData`.

```typescript
interface TelegramMiniAppUser {
  allows_write_to_pm?: boolean;
  first_name: string;
  id: number;
  is_bot?: boolean;
  is_premium?: boolean;
  language_code?: string;
  last_name?: string;
  photo_url?: string;
  username?: string;
}
```

### `TelegramMiniAppChat`

Chat object from Telegram Mini Apps `initData`.

```typescript
interface TelegramMiniAppChat {
  id: number;
  photo_url?: string;
  title?: string;
  type: string;
  username?: string;
}
```

### `TelegramMiniAppData`

Complete parsed data from Telegram Mini Apps `initData`.

```typescript
interface TelegramMiniAppData {
  auth_date: number;
  can_send_after?: number;
  chat?: TelegramMiniAppChat;
  chat_instance?: string;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  hash: string;
  query_id?: string;
  receiver?: TelegramMiniAppUser;
  start_param?: string;
  user?: TelegramMiniAppUser;
}
```

### `TelegramAccountRecord`

Account record as returned by the Better Auth adapter.

```typescript
interface TelegramAccountRecord {
  accountId: string;
  id: string;
  providerId: string;
  telegramId?: string;
  telegramUsername?: string;
  userId: string;
}
```

### `TelegramWidgetOptions`

Options for the Telegram Login Widget (client-side).

```typescript
interface TelegramWidgetOptions {
  cornerRadius?: number;         // default: 20
  lang?: string;                 // no default (uses user's language)
  requestAccess?: boolean;       // default: false
  showUserPhoto?: boolean;       // default: true
  size?: "large" | "medium" | "small"; // default: "large"
}
```

---

## Endpoints

The plugin registers these endpoints under `/telegram/*`. Better Auth prefixes them with its base path (typically `/api/auth`), so the full path is usually `/api/auth/telegram/signin`, etc. The paths below show the plugin-level paths.

---

### `POST /telegram/signin`

Sign in or create a user with Telegram Login Widget data. No session required.

**Request Body:** `TelegramAuthData`

```json
{
  "id": 123456789,
  "first_name": "John",
  "last_name": "Doe",
  "username": "johndoe",
  "photo_url": "https://t.me/i/userpic/...",
  "auth_date": 1234567890,
  "hash": "abc123def456..."
}
```

**Success (200):**

```json
{
  "user": { "id": "...", "name": "John Doe", "telegramId": "123456789", "..." },
  "session": { "id": "...", "userId": "...", "token": "...", "..." }
}
```

Sets a session cookie via `setSessionCookie`.

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_AUTH_DATA` | Missing required fields (`id`, `first_name`, `auth_date`, `hash`) |
| 401 | `INVALID_AUTHENTICATION` | HMAC verification failed or `auth_date` too old |
| 404 | `USER_CREATION_DISABLED` | No existing account and `autoCreateUser` is `false` |

---

### `POST /telegram/link`

Link a Telegram account to the currently authenticated user. Requires a valid session (uses `sessionMiddleware`).

**Request Body:** `TelegramAuthData`

**Success (200):**

```json
{
  "success": true,
  "message": "Telegram account linked successfully"
}
```

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_AUTH_DATA` | Missing required fields |
| 401 | `INVALID_AUTHENTICATION` | HMAC verification failed or `auth_date` too old |
| 401 | `NOT_AUTHENTICATED` | No valid session |
| 403 | `LINKING_DISABLED` | `allowUserToLink` is `false` |
| 409 | `TELEGRAM_ALREADY_LINKED_OTHER` | Telegram account is linked to a different user |
| 409 | `TELEGRAM_ALREADY_LINKED_SELF` | Telegram account is already linked to your account |

---

### `POST /telegram/unlink`

Unlink the Telegram account from the currently authenticated user. Requires a valid session (uses `sessionMiddleware`).

**Request Body:** None

**Success (200):**

```json
{
  "success": true,
  "message": "Telegram account unlinked successfully"
}
```

**Errors:**

| Status | Code | When |
|---|---|---|
| 401 | `NOT_AUTHENTICATED` | No valid session |
| 404 | `NOT_LINKED` | No Telegram account linked to this user |

---

### `GET /telegram/config`

Returns the bot configuration for client-side widget initialization. No authentication required.

**Response (200):**

```json
{
  "botUsername": "my_auth_bot",
  "miniAppEnabled": false,
  "oidcEnabled": false,
  "testMode": false
}
```

---

### `POST /telegram/miniapp/signin`

Sign in from a Telegram Mini App. Only available when `miniApp.enabled` is `true`. Returns a 404 if you try to hit it with Mini Apps disabled -- the endpoint literally doesn't exist.

**Request Body:**

```json
{
  "initData": "query_id=...&user=...&auth_date=...&hash=..."
}
```

**Success (200):**

```json
{
  "user": { "id": "...", "name": "...", "telegramId": "...", "..." },
  "session": { "id": "...", "userId": "...", "token": "...", "..." }
}
```

Sets a session cookie via `setSessionCookie`.

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `INIT_DATA_REQUIRED` | `initData` missing or not a string |
| 400 | `INVALID_MINI_APP_DATA_STRUCTURE` | Parsed data fails structural validation |
| 400 | `NO_USER_IN_INIT_DATA` | No `user` object in parsed `initData` |
| 401 | `INVALID_MINI_APP_INIT_DATA` | HMAC verification failed (when `validateInitData` is `true`) |
| 404 | `MINI_APP_AUTO_SIGNIN_DISABLED` | No existing account and `autoCreateUser` or `allowAutoSignin` is `false` |

---

### `POST /telegram/miniapp/validate`

Validate Mini App `initData` without creating a session. Only available when `miniApp.enabled` is `true`.

**Request Body:**

```json
{
  "initData": "query_id=...&user=...&auth_date=...&hash=..."
}
```

**Valid response (200):**

```json
{
  "valid": true,
  "data": {
    "auth_date": 1234567890,
    "user": { "id": 123456789, "first_name": "John", "..." },
    "hash": "..."
  }
}
```

**Invalid response (200):**

```json
{
  "valid": false,
  "data": null
}
```

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `INIT_DATA_REQUIRED` | `initData` missing or not a string |

---

### OIDC Routes

OIDC doesn't register custom endpoints. It injects a `telegram-oidc` social provider via the `init` hook, and Better Auth's built-in routes handle the rest:

- **`POST /sign-in/social`** with `{ provider: "telegram-oidc", callbackURL: "/dashboard" }` — initiates the OAuth 2.0 Authorization Code flow with PKCE
- **`GET /callback/telegram-oidc`** — handles the OAuth callback, verifies the RS256 JWT ID token against Telegram's JWKS endpoint, creates/links user, sets session

Zero custom endpoints. Delegation at its finest.

---

## Error Codes

The `$ERROR_CODES` object exposed by the plugin. Since v1.1.0, each code is a `RawError` object (`{ code, message }`) created via `defineErrorCodes()` from `@better-auth/core`. The `code` is the UPPER_SNAKE_CASE key, the `message` is the human-readable string. `toString()` returns the code. Bookmark this for your 3am debugging sessions.

| Code | Message |
|------|---------|
| `BOT_TOKEN_REQUIRED` | Telegram plugin: botToken is required |
| `BOT_USERNAME_REQUIRED` | Telegram plugin: botUsername is required |
| `INVALID_AUTH_DATA` | Invalid Telegram auth data |
| `INVALID_AUTHENTICATION` | Invalid Telegram authentication |
| `USER_CREATION_DISABLED` | User not found and auto-create is disabled |
| `NOT_AUTHENTICATED` | Not authenticated |
| `LINKING_DISABLED` | Linking Telegram accounts is disabled |
| `TELEGRAM_ALREADY_LINKED_OTHER` | This Telegram account is already linked to another user |
| `TELEGRAM_ALREADY_LINKED_SELF` | This Telegram account is already linked to your account |
| `NOT_LINKED` | No Telegram account linked |
| `INIT_DATA_REQUIRED` | initData is required and must be a string |
| `INVALID_MINI_APP_INIT_DATA` | Invalid Mini App initData |
| `INVALID_MINI_APP_DATA_STRUCTURE` | Invalid Mini App data structure |
| `NO_USER_IN_INIT_DATA` | No user data in initData |
| `MINI_APP_AUTO_SIGNIN_DISABLED` | User not found and auto-signin is disabled for Mini Apps |

```typescript
// Matching errors client-side:
if (error.code === plugin.$ERROR_CODES.NOT_AUTHENTICATED.code) {
  // redirect to login
}
```

### Success Messages

```typescript
const SUCCESS_MESSAGES = {
  TELEGRAM_LINKED: "Telegram account linked successfully",
  TELEGRAM_UNLINKED: "Telegram account unlinked successfully",
} as const;
```

### Constants

```typescript
const PLUGIN_ID = "telegram";
const DEFAULT_MAX_AUTH_AGE = 86400; // 24 hours in seconds
```

---

## Rate Limits

Every endpoint is rate-limited because apparently some people can't be trusted with HTTP requests.

| Endpoint | Max Requests | Window |
|---|---|---|
| `/telegram/signin` | 10 | 60 seconds |
| `/telegram/link` | 5 | 60 seconds |
| `/telegram/unlink` | 5 | 60 seconds |
| `/telegram/miniapp/signin` | 10 | 60 seconds |
| `/telegram/miniapp/validate` | 20 | 60 seconds |

---

## Schema Extensions

The plugin extends Better Auth's database schema with these fields. User fields have `input: false` -- they're managed by the plugin, not by your users.

### User Table

| Field | Type | Required | Unique | Input | Notes |
|---|---|---|---|---|---|
| `telegramId` | `string` | `false` | `false` | `false` | |
| `telegramUsername` | `string` | `false` | `false` | `false` | |
| `telegramPhoneNumber` | `string` | `false` | `false` | `false` | Populated via OIDC with `phone` scope |

### Account Table

| Field | Type | Required | Unique |
|---|---|---|---|
| `telegramId` | `string` | `false` | `false` |
| `telegramUsername` | `string` | `false` | `false` |

Account fields do not have the `input: false` constraint.

---

## Verification (Internal)

The plugin handles all verification internally. These functions live in `src/verify.ts` and are **not exported** from the package -- you don't need to call them yourself. Documented here so you know what's happening under the hood when your auth request either sails through or gets rejected.

All use the Web Crypto API (`crypto.subtle`), so the plugin works in Node.js, Deno, Cloudflare Workers, and anywhere else that isn't stuck in 2015.

### Login Widget Verification

1. Check `auth_date` is not older than `maxAuthAge`
2. Build data-check-string from sorted `key=value` pairs (excluding `hash`)
3. Compute `secret = SHA-256(botToken)`
4. Compute `HMAC-SHA-256(secret, dataCheckString)`
5. Compare with received `hash`

### Mini App Verification

1. Extract `hash` from URL params
2. Check `auth_date` is not older than `maxAuthAge`
3. Build data-check-string from sorted remaining params
4. Compute `secret = HMAC-SHA-256("WebAppData", botToken)`
5. Compute `HMAC-SHA-256(secret, dataCheckString)`
6. Compare with received `hash`

### Structural Validation

Before any cryptographic check, the plugin validates that the incoming data has the right shape:

- **Login Widget:** `id` (number), `first_name` (string), `auth_date` (number), `hash` (string)
- **Mini App:** `auth_date` (number), `hash` (string), and if `user` exists: `id` (number), `first_name` (string)

---

## Next Steps

- [Installation Guide](./installation.md)
- [Configuration Guide](./configuration.md)
- [Mini Apps Guide](./miniapps.md)
- [Security Best Practices](./security.md)
- [Troubleshooting](./troubleshooting.md)
