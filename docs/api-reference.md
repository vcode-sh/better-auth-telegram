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

The main server plugin function. Returns a `BetterAuthPlugin` object. Credentials are checked per enabled flow: missing values warn during setup and the affected request fails closed at runtime.

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
| `botToken` | `string` | `undefined` | Required at runtime for enabled Login Widget and Mini App flows. Can provide the OIDC client ID fallback. |
| `botUsername` | `string` | `undefined` | Required when rendering the Login Widget. Bot username without the `@`. |
| `loginWidget` | `boolean` | `true` | Enable Login Widget endpoints. Telegram schema fields stay enabled while Mini App support is active; with both off, no columns are added. |
| `allowUserToLink` | `boolean` | `true` | Allow authenticated users to link their Telegram account. |
| `autoCreateUser` | `boolean` | `true` | Auto-create a user when a new Telegram user signs in. |
| `maxAuthAge` | `number` | `86400` (24 hours) | Maximum age of `auth_date` in seconds. Prevents replay attacks. |
| `mapTelegramDataToUser` | `(data: TelegramAuthData) => UserData` | Uses `first_name`/`last_name` for name, `photo_url` for image, placeholder email | Custom mapping from Telegram data, merged over the defaults. |
| `miniApp` | `object` | `undefined` | Telegram Mini Apps configuration. See below. |
| `oidc` | `TelegramOIDCOptions` | `undefined` | Telegram OIDC configuration. See below. |
| `testMode` | `boolean` | `false` | Informational: returned by `GET /telegram/config`. Changes no verification or widget behavior. Logs a warning together with OIDC. |

##### `miniApp` Options

| Option | Type | Default | Description |
|---|---|---|---|
| `miniApp.enabled` | `boolean` | `false` | Enable Mini App endpoints. They literally don't exist until you flip this. |
| `miniApp.validateInitData` | `boolean` | `true` | Verify the HMAC signature of `initData`. `false` lets anyone sign in as any Telegram user and logs a startup warning. `/telegram/miniapp/validate` always verifies. |
| `miniApp.allowAutoSignin` | `boolean` | `true` | Allow auto-creation of users from Mini App sign-in. |
| `miniApp.mapMiniAppDataToUser` | `(data: TelegramMiniAppUser) => UserData` | Uses `first_name`/`last_name` for name, `photo_url` for image, placeholder email | Custom mapping from Mini App user data, merged over the defaults. |

##### `oidc` Options

| Option | Type | Default | Description |
|---|---|---|---|
| `oidc.enabled` | `boolean` | `false` | Enable Telegram OIDC. Injects `telegram-oidc` social provider via the `init` hook. |
| `oidc.clientId` | `string` | bot ID from `botToken` | Client ID from BotFather > your bot > Login Widget (the bot's id). Required when `botToken` is omitted or the OIDC bot differs from the Login Widget bot. |
| `oidc.clientSecret` | `string` | none (required) | Client Secret from the same page. No bot-token fallback: startup warns and OIDC logins throw until it's set. |
| `oidc.disableIdTokenSignIn` | `boolean` | `false` | Reject client-submitted ID tokens on `POST /sign-in/social` and `/link-social`. |
| `oidc.disableSignUp` | `boolean` | `false` | Only sign in existing users; never create one from OIDC. |
| `oidc.overrideUserInfoOnSignIn` | `boolean` | `false` | Refresh the user's name and photo from the ID token on every sign-in. |
| `oidc.scopes` | `string[]` | `["openid", "profile"]` | OIDC scopes to request. `openid` is always added; `profile` only when you don't pass a list. |
| `oidc.requestPhone` | `boolean` | `false` | Add `phone` scope. With the Telegram columns present, `phone_number` is copied to `user.telegramPhoneNumber`. |
| `oidc.requestBotAccess` | `boolean` | `false` | Add `telegram:bot_access` scope. |
| `oidc.mapOIDCProfileToUser` | `(claims: TelegramOIDCClaims) => UserData` | `name` (or given + family name, or `preferred_username`), `picture`, placeholder email | Customize `name` / `email` / `image`; merged over the defaults. A returned `id` is ignored; `input: false` fields such as `telegramId` are dropped by Better Auth. |

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
- `init`: OIDC social provider injection (when `oidc.enabled`), plus `databaseHooks`: always the placeholder email guard; with the Telegram columns, also copying the verified OIDC identity onto its user and re-checking `user.telegramId` whenever a `telegram` or `telegram-oidc` account is deleted
- `endpoints`: `/telegram/config` always, 3 Login Widget endpoints (unless `loginWidget: false`), 2 Mini App endpoints (when `miniApp.enabled`)
- `schema`: Database schema extensions for `user` and `account` tables (only when the Login Widget or Mini App is enabled)
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
        // A second bot: switching a bot to OIDC disables its Login Widget
        clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
        clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
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

**Returns:** `{ botUsername: string, loginWidgetEnabled: boolean, miniAppEnabled: boolean, oidcEnabled: boolean, testMode: boolean }`

---

#### `initTelegramWidget(containerId, options?, onAuth)`

Render the Telegram Login Widget with a callback. Loads the widget script (`https://telegram.org/js/telegram-widget.js?24`), fetches `botUsername` from your server, and injects the widget into your DOM. All automatic. You're welcome.

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

Automatically grabs `initData` from `window.Telegram.WebApp.initData`, falling back to the `tgWebAppData` URL-fragment launch parameter, and signs in. Throws when neither source is available.

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

#### `signInWithTelegramOIDC(options?, fetchOptions?)`

Trigger the Telegram OIDC sign-in flow. Redirects to `oauth.telegram.org` for authentication, then back to your callback URL. Standard Better Auth social login under the hood — PKCE, state tokens, the works. Only works when `oidc.enabled` is `true` on the server.

```typescript
await authClient.signInWithTelegramOIDC({
  callbackURL: "/dashboard",
});
```

| Parameter | Type | Description |
|---|---|---|
| `options.callbackURL` | `string` | URL to redirect after authentication |
| `options.errorCallbackURL` | `string` | URL to redirect to when the flow fails |
| `fetchOptions` | `Record<string, any>` | Optional fetch customization |

**Returns:** The `POST /sign-in/social` response (the authorization URL; Better Auth's client redirects the browser). After the callback, the user has a session.

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
  botToken?: string;             // Widget/Mini App runtime credential
  botUsername?: string;          // required when rendering the Widget
  loginWidget?: boolean;         // default: true
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
  clientId?: string;             // BotFather > your bot > Login Widget; falls back to bot ID
  clientSecret?: string;         // same page; NOT the bot token. Required
  disableIdTokenSignIn?: boolean; // default: false — reject client-submitted ID tokens
  disableSignUp?: boolean;       // default: false — existing users only
  overrideUserInfoOnSignIn?: boolean; // default: false — refresh name/photo on sign-in
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

JWT ID token claims from Telegram OIDC. What you get back after the OAuth dance, verified before you ever see them.

```typescript
interface TelegramOIDCClaims {
  aud: string;                   // configured OIDC client ID
  exp: number;                   // expiration timestamp (tokens live 30 s)
  family_name?: string;
  given_name?: string;
  iat: number;                   // issued at timestamp
  id?: string;                   // Telegram user ID, as a string ("8306595751")
  iss: string;                   // "https://oauth.telegram.org"
  name?: string;                 // display name
  nonce?: string;                // echoed from the authorization request
  phone_number?: string;         // digits only, no "+"; only with "phone" scope
  phone_number_verified?: boolean;
  picture?: string;              // profile photo URL
  preferred_username?: string;   // Telegram username
  sub: string;                   // per-bot subject, NOT the Telegram user ID
}
```

`id` is the same number the Login Widget and Mini Apps report, but Telegram sends it as a string (its docs show a number; the live endpoint doesn't). `sub` is scoped per bot: the same user gets a different `sub` from each bot, even though discovery claims `subject_types_supported: ["public"]`. It's also the OIDC account id, so switching bots or client ids gives every OIDC user a new account.

Profile claims (`id`, names, `picture`, `preferred_username`) need the `profile` scope. Bots that sign with `EdDSA` or `ES256K` get none of them: the token carries only `iss`, `aud`, `sub`, `iat`, `exp` (the plugin logs a warning when `id` is missing).

### `TelegramMiniAppUser`

User object from Telegram Mini Apps `initData`.

```typescript
interface TelegramMiniAppUser {
  added_to_attachment_menu?: boolean;
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
  chat_join_request_query_id?: string; // opened from a chat join request
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  hash: string;
  query_id?: string;
  receiver?: TelegramMiniAppUser;
  signature?: string;            // Ed25519, for third-party validation (not checked by the plugin)
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

Lookup order: the `telegram` account with this Telegram id (duplicate rows left by older versions are tolerated), then a user whose `telegramId` matches (for example one created by OIDC or a Mini App; the account is linked to them, in a transaction, unless `account.accountLinking.enabled` is `false` or `disableImplicitLinking` is `true`), then a new user, if `autoCreateUser` allows (user and account created in a transaction). Writes go through Better Auth's internal adapter, so `databaseHooks` run. `user.validateUserInfo` is called with `source.method: "telegram-login-widget"` and `source.action` `"sign-in"` (returning user), `"link-account"` (linked by `telegramId`) or `"create-user"` (new user). Every sign-in refreshes `telegramUsername` on the user and the account (and clears it when Telegram sends none).

Sign-ins of the same Telegram user run one at a time per Better Auth instance, so a double submit creates one user. If another server creates the user first and the database refuses the second copy (unique `user.email`), the request signs in as that user.

Like Better Auth's `/sign-in/email`, the endpoint refuses browser requests from origins outside `trustedOrigins` (Better Auth's `formCsrfMiddleware`), even without cookies: otherwise a page on another site could post the attacker's own fresh Telegram data and sign the visitor into the attacker's account.

Fields containing a line break are rejected before the HMAC check.

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_AUTH_DATA` | Missing required fields (`id`, `first_name`, `auth_date`, `hash`) |
| 401 | `INVALID_AUTHENTICATION` | HMAC verification failed, `auth_date` too old or more than 60 s in the future |
| 401 | `ACCOUNT_NOT_LINKED` | A user has this `telegramId` but no `telegram` account, and `account.accountLinking.enabled` is `false` or `disableImplicitLinking` is `true` |
| 403 | `INVALID_ORIGIN` | Browser request from an origin outside `trustedOrigins` (Better Auth) |
| 403 | your code | `user.validateUserInfo` rejected the sign-in, link or sign-up |
| 403 | `validation_failed` | `user.validateUserInfo` threw (fails closed) |
| 403 | `USER_CREATION_REJECTED` | A database hook vetoed creating the user |
| 404 | `USER_CREATION_DISABLED` | No existing account and `autoCreateUser` is `false` |
| 500 | `BOT_TOKEN_REQUIRED` | `botToken` is not configured |
| 500 | `ORPHANED_ACCOUNT` | The Telegram account row references a user that no longer exists |

---

### `POST /telegram/link`

Link a Telegram account to the currently authenticated user. Requires a valid session (uses `sessionMiddleware`). One Telegram identity per user: linking a different Telegram id than the user already has is refused. `user.validateUserInfo` runs first with action `"link-account"`; the account link and the user update happen in a transaction.

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
| 401 | `INVALID_AUTHENTICATION` | HMAC verification failed or `auth_date` out of range |
| 401 | `UNAUTHORIZED` | No valid session (Better Auth's `sessionMiddleware`) |
| 403 | `LINKING_DISABLED` | `allowUserToLink` is `false`, or Better Auth's `account.accountLinking.enabled` is `false` |
| 403 | your code / `validation_failed` | `user.validateUserInfo` rejected (or threw) |
| 409 | `TELEGRAM_ALREADY_LINKED_OTHER` | Telegram account is linked to a different user, or another user already has this `telegramId` on their profile |
| 409 | `TELEGRAM_ALREADY_LINKED_SELF` | Telegram account is already linked to your account |
| 409 | `DIFFERENT_TELEGRAM_ACCOUNT_LINKED` | Your account already has a different Telegram id |
| 500 | `BOT_TOKEN_REQUIRED` | `botToken` is not configured |

On success the user's `telegramId` and `telegramUsername` are set, and the session cookie is re-issued so `session.cookieCache` serves them right away (`/telegram/unlink` does the same).

---

### `POST /telegram/unlink`

Unlink the Telegram account from the currently authenticated user. Requires a fresh session (uses Better Auth's `freshSessionMiddleware`, like `/unlink-account`): the session must be younger than `session.freshAge` (default 1 day).

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
| 400 | `CANNOT_UNLINK_LAST_ACCOUNT` | Telegram is the user's only account and `account.accountLinking.allowUnlinkingAll` isn't `true` |
| 401 | `UNAUTHORIZED` | No valid session (Better Auth's `freshSessionMiddleware`) |
| 403 | `SESSION_NOT_FRESH` | Session older than `session.freshAge` |
| 404 | `NOT_LINKED` | No Telegram account linked to this user |

Removes the `telegram` account, then re-checks the user: if another remaining Telegram account (`telegram-oidc` with `account.telegramId`) proves the stored `telegramId`, it stays; if one proves a different id, the user switches to it; otherwise `telegramId`, `telegramUsername` and `telegramPhoneNumber` are cleared. The same re-check runs from an `account.delete` database hook whenever any `telegram` or `telegram-oidc` account is removed, including through Better Auth's `POST /unlink-account`, so an unlinked Telegram user can no longer sign in through the `telegramId` lookup. OIDC accounts created before v3 carry no `account.telegramId` until their next OIDC sign-in.

---

### `GET /telegram/config`

Returns the bot configuration for client-side widget initialization. No authentication required.

**Response (200):**

```json
{
  "botUsername": "my_auth_bot",
  "loginWidgetEnabled": true,
  "miniAppEnabled": false,
  "oidcEnabled": false,
  "testMode": false
}
```

`testMode` is just your config echoed back; nothing else reads it.

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

Same lookup, provisioning, username refresh and origin check as `/telegram/signin`, with `source.method: "telegram-mini-app"` for `user.validateUserInfo`. The signed-in user is `user`, never the chat partner in `receiver`. A Mini App user and a Login Widget user with the same Telegram id are the same user.

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `INIT_DATA_REQUIRED` | `initData` missing or not a string |
| 400 | `INVALID_MINI_APP_DATA_STRUCTURE` | Parsed data fails structural validation |
| 400 | `NO_USER_IN_INIT_DATA` | No `user` object in parsed `initData` |
| 401 | `INVALID_MINI_APP_INIT_DATA` | HMAC verification failed or `auth_date` out of range (when `validateInitData` is `true`) |
| 401 | `ACCOUNT_NOT_LINKED` | As for `/telegram/signin` |
| 403 | `INVALID_ORIGIN` | Browser request from an origin outside `trustedOrigins`: a Mini App served from another origin than the auth server needs that origin there |
| 403 | your code / `validation_failed` | `user.validateUserInfo` rejected (or threw) |
| 403 | `USER_CREATION_REJECTED` | A database hook vetoed creating the user |
| 404 | `MINI_APP_AUTO_SIGNIN_DISABLED` | No existing account and `autoCreateUser` or `allowAutoSignin` is `false` |
| 500 | `BOT_TOKEN_REQUIRED` | `botToken` is not configured |
| 500 | `ORPHANED_ACCOUNT` | The Telegram account row references a user that no longer exists |

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
| 500 | `BOT_TOKEN_REQUIRED` | `botToken` is not configured |

This endpoint always verifies, regardless of `miniApp.validateInitData`.

---

### OIDC Routes

OIDC doesn't register custom endpoints. It injects a `telegram-oidc` social provider via the `init` hook, and Better Auth's built-in routes handle the rest:

- **`POST /sign-in/social`** with `{ provider: "telegram-oidc", callbackURL: "/dashboard" }` — initiates the OAuth 2.0 Authorization Code flow with PKCE and a nonce
- **`GET /callback/telegram-oidc`** — handles the OAuth callback: exchanges the code with HTTP Basic client authentication, verifies the ID token (signature against Telegram's cached JWKS using `RS256`, `ES256` or `EdDSA`; `iss`, `aud`, `exp`/`iat` with 30 s tolerance, required claims, nonce), creates/links the user, sets the session. Telegram token errors (HTTP 200 with an `error` field) redirect with `error=invalid_code`; a rejected ID token with `error=unable_to_get_user_info`; `oidc.disableSignUp` with an unknown user with `error=signup_disabled`
- **`POST /sign-in/social`** with `{ provider: "telegram-oidc", idToken: { token, nonce } }` — signs in with an ID token you already have, verified the same way. The `nonce` the token was issued for is required (Better Auth treats it as optional; the plugin doesn't); forged, nonce-less or mismatched tokens get a 401. Tokens live 30 seconds. Turned off with `oidc.disableIdTokenSignIn`, which also covers `/link-social`

Provider details for Better Auth 1.7: id `telegram-oidc`, `issuer: "https://oauth.telegram.org"`, `requiresIdTokenNonce: true`, an `idToken.verify` that insists on the nonce, and `accountSubject` = the `sub` claim (so account ids are unchanged from v2).

Verified claims are applied only to the user who owns the `telegram-oidc` account whose id equals the token's `sub`, and copied (with the Telegram columns) to `user.telegramId` / `telegramUsername` / `telegramPhoneNumber` and to `account.telegramId` / `telegramUsername`.

Known limitations: with Better Auth's `oauth-proxy` plugin the Telegram id isn't copied onto the user (the claims are verified on the server that exchanges the code; the user is created on the other); `/account-info` stops working for `telegram-oidc` after about 30 s (30-second tokens, no refresh token); an OIDC sign-in doesn't find an existing Login Widget / Mini App user (issue #25, reverse direction); with `session.cookieCache`, the Telegram fields an OIDC link (`/link-social`) or `/unlink-account` changes show up in the session only once the cache expires, because those Better Auth routes don't re-issue the cookie; and when Telegram rotates its signing key, ID tokens signed with the new key fail for up to 30 s after the plugin last fetched the key set (jose refetches an unknown `kid` at most every 30 s).

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
| `NOT_AUTHENTICATED` | Not authenticated (defined, not thrown) |
| `LINKING_DISABLED` | Linking Telegram accounts is disabled |
| `TELEGRAM_ALREADY_LINKED_OTHER` | This Telegram account is already linked to another user |
| `TELEGRAM_ALREADY_LINKED_SELF` | This Telegram account is already linked to your account |
| `NOT_LINKED` | No Telegram account linked |
| `DIFFERENT_TELEGRAM_ACCOUNT_LINKED` | A different Telegram account is already linked to your account |
| `CANNOT_UNLINK_LAST_ACCOUNT` | Cannot unlink Telegram: it is the only way to sign in to this account |
| `USER_CREATION_REJECTED` | User creation was rejected |
| `ORPHANED_ACCOUNT` | Telegram account references a user that does not exist |
| `PLACEHOLDER_EMAIL_RESERVED` | Telegram placeholder email addresses are reserved for Telegram sign-in |
| `ACCOUNT_NOT_LINKED` | A user with this Telegram account exists, but the account is not linked and account linking does not allow linking it on sign-in |
| `INIT_DATA_REQUIRED` | initData is required and must be a string |
| `INVALID_MINI_APP_INIT_DATA` | Invalid Mini App initData |
| `INVALID_MINI_APP_DATA_STRUCTURE` | Invalid Mini App data structure |
| `NO_USER_IN_INIT_DATA` | No user data in initData |
| `MINI_APP_AUTO_SIGNIN_DISABLED` | User not found and auto-signin is disabled for Mini Apps |

`NOT_AUTHENTICATED` is still defined, but no endpoint throws it: a missing session on `/telegram/link` and `/telegram/unlink` is rejected by Better Auth's session middleware with 401 `UNAUTHORIZED`. Better Auth's own codes you may also see: `SESSION_NOT_FRESH` (403, unlink), `validation_failed` (403, a throwing `validateUserInfo`), `INVALID_ORIGIN` (403, sign-in from an untrusted origin) and `BANNED_USER` (403, the admin plugin).

```typescript
// Matching errors client-side:
if (error.code === plugin.$ERROR_CODES.CANNOT_UNLINK_LAST_ACCOUNT.code) {
  // ask the user to add another sign-in method first
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
const TELEGRAM_OIDC_PROVIDER_ID = "telegram-oidc";
const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_OIDC_JWKS_URI = "https://oauth.telegram.org/.well-known/jwks.json";
```

These live in `src/constants.ts` and are not exported from the package.

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

The plugin extends Better Auth's database schema with these fields, only when the Login Widget or Mini App is enabled. User fields have `input: false` -- they're managed by the plugin, not by your users (or your mappers: Better Auth drops `input: false` fields from mapper output too).

`required: false` means nullable, not optional to migrate. Better Auth >= 1.7.3 validates the schema at startup and answers every auth request with a 500 (`Database schema mismatch ... Missing columns`) until all five columns exist. Run `npx auth@latest generate` (Prisma/Drizzle) or `npx auth@latest migrate` (Kysely), then `npx auth@latest check schema`.

### User Table

| Field | Type | Required | Unique | Index | Input | Notes |
|---|---|---|---|---|---|---|
| `telegramId` | `string` | `false` | `false` | `true` | `false` | Looked up on every Login Widget / Mini App sign-in; also filled from the OIDC `id` claim |
| `telegramUsername` | `string` | `false` | `false` | `false` | `false` | Refreshed on every sign-in; filled from OIDC `preferred_username` |
| `telegramPhoneNumber` | `string` | `false` | `false` | `false` | `false` | Filled from the OIDC `phone_number` claim with `oidc.requestPhone` |

### Account Table

| Field | Type | Required | Unique |
|---|---|---|---|
| `telegramId` | `string` | `false` | `false` |
| `telegramUsername` | `string` | `false` | `false` |

Account fields do not have the `input: false` constraint. `telegram` accounts get them from the Login Widget / Mini App payload, `telegram-oidc` accounts from the verified `id` / `preferred_username` claims. They're what keeps `user.telegramId` honest: when a Telegram account is deleted, the user keeps only a `telegramId` that a remaining Telegram account still proves.

---

## Verification (Internal)

The plugin handles all verification internally. These functions live in `src/verify.ts` and are **not exported** from the package -- you don't need to call them yourself. Documented here so you know what's happening under the hood when your auth request either sails through or gets rejected.

All use the Web Crypto API (`crypto.subtle`), so the plugin works in Node.js, Deno, Cloudflare Workers, and anywhere else that isn't stuck in 2015.

### Login Widget Verification

1. Check `auth_date` is an integer Unix time, not older than `maxAuthAge` and at most 60 s in the future
2. Reject any field (key or value) containing a line break, so one signed field can't be re-split into several
3. Build data-check-string from sorted `key=value` pairs (excluding `hash`)
4. Compute `secret = SHA-256(botToken)`
5. Check that `hash` is 64 lowercase hex characters
6. Verify `HMAC-SHA-256(secret, dataCheckString)` against it in constant time (`crypto.subtle.verify`)

### Mini App Verification

1. Extract `hash` from URL params
2. Check `auth_date` is an integer Unix time, not older than `maxAuthAge` and at most 60 s in the future
3. Build data-check-string from sorted remaining params (`signature` included, as Telegram specifies)
4. Compute `secret = HMAC-SHA-256("WebAppData", botToken)`
5. Check that `hash` is 64 lowercase hex characters
6. Verify `HMAC-SHA-256(secret, dataCheckString)` against it in constant time

Third-party Ed25519 validation of `signature` (without the bot token) is not implemented.

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
