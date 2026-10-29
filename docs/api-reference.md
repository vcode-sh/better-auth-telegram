# API reference

Everything the package exports, every endpoint, every error code. This page is for looking things up; for explanations, see the guides linked from the [docs index](./README.md).

## Contents

- [Exports](#exports)
- [Server: `telegram(options)`](#server-telegramoptions)
- [Server: `createTelegramOIDCProvider`](#server-createtelegramoidcprovider)
- [Client: `telegramClient()`](#client-telegramclient)
- [Client actions](#client-actions)
- [Types](#types)
- [Endpoints](#endpoints)
- [OIDC routes](#oidc-routes)
- [Error codes](#error-codes)
- [Rate limits](#rate-limits)
- [Database schema](#database-schema)

## Exports

**`better-auth-telegram`** (server):

| Export | Kind |
|---|---|
| `telegram` | function: the Better Auth plugin |
| `createTelegramOIDCProvider` | function: the OIDC provider (used internally) |
| `TELEGRAM_ERROR_CODES` | object: error codes |
| `TelegramPluginOptions`, `TelegramOIDCOptions`, `TelegramPluginConfig` | types: options |
| `TelegramAuthData`, `TelegramMiniAppData`, `TelegramMiniAppUser`, `TelegramMiniAppChat`, `TelegramOIDCClaims`, `TelegramAccountRecord` | types: data |

**`better-auth-telegram/client`** (browser; contains no server code):

| Export | Kind |
|---|---|
| `telegramClient` (also the default export) | function: the Better Auth client plugin |
| `TELEGRAM_ERROR_CODES` | object: error codes |
| `TelegramWidgetOptions`, `TelegramWidget` | types: widget |
| `TelegramSignInResponse`, `TelegramLinkResponse`, `TelegramUser`, `TelegramClientError` | types: responses |

Both entries ship as ESM and CommonJS with type declarations.

## Server: `telegram(options)`

```ts
import { telegram } from "better-auth-telegram";

export const telegramPlugin = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
});
```

Returns a Better Auth plugin. Every option, with defaults, is in [Configuration](./configuration.md#plugin-options). The plugin never throws for a missing credential: it logs a [startup warning](./configuration.md#startup-warnings) and the affected requests fail with an error code.

The returned plugin has:

| Property | Content |
|---|---|
| `id` | `"telegram"` |
| `init` | Adds the `telegram-oidc` social provider (when `oidc.enabled`). Installs database hooks: always the placeholder-email guard; with the Telegram columns, also copying verified OIDC details onto their user and re-checking `user.telegramId` whenever a `telegram` or `telegram-oidc` account is deleted. Logs startup warnings. |
| `schema` | The [Telegram columns](#database-schema), only when the Login Widget or Mini App is enabled. |
| `endpoints` | `/telegram/config` always; the three Login Widget endpoints unless `loginWidget: false`; the two Mini App endpoints when `miniApp.enabled`. |
| `rateLimit` | [Rules](#rate-limits) for the enabled endpoints. |
| `$ERROR_CODES` | [`TELEGRAM_ERROR_CODES`](#error-codes). |

**Type inference.** The Telegram fields are part of the inferred user type on the server (`auth.$Infer.Session`, `auth.api.getSession`) and the client (`useSession`, `$Infer`), as `string | null | undefined`. In OIDC-only mode they exist in the types but are never set.

**Plugin registry.** The package augments Better Auth's `BetterAuthPluginRegistry`, so `ctx.getPlugin("telegram")` is typed.

**Calling endpoints from the server.** They are on `auth.api` (`signInWithTelegram`, `linkTelegram`, `unlinkTelegram`, `getTelegramConfig`, `signInWithMiniApp`, `validateMiniApp`). Because they depend on options, TypeScript types them as possibly `undefined`, and their request bodies are not typed.

## Server: `createTelegramOIDCProvider`

```ts
createTelegramOIDCProvider(
  botToken: string,
  options?: TelegramOIDCOptions,
  logger?: { warn: (message: string, ...args: unknown[]) => void } // default: console
): OAuthProvider<TelegramOIDCClaims>
```

The `telegram-oidc` provider the plugin adds when `oidc.enabled` is `true`. You don't need to call it yourself. Used on its own, it doesn't install the plugin's database hooks (placeholder guard, identity copying).

Provider details: id `telegram-oidc`, issuer `https://oauth.telegram.org`, `requiresIdTokenNonce: true`, `accountSubject` = the `sub` claim (account IDs are the same as in v2), an `idToken.verify` that requires the nonce, HTTP Basic client authentication at the token endpoint, and ID-token verification against Telegram's JWKS (RS256, ES256, EdDSA) before any claim is used.

## Client: `telegramClient()`

```ts
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  plugins: [telegramClient()],
});
```

No options. Adds the [actions](#client-actions) below to the client, and `$ERROR_CODES`.

## Client actions

**Results.** Actions that call the server return Better Auth's `{ data, error }`. On failure, `data` is `null` and `error` has `status`, `statusText`, and usually `code` and `message` (`TelegramClientError`). Compare `code` with [`TELEGRAM_ERROR_CODES`](#error-codes) or Better Auth's codes. Network failures throw, as with every Better Auth client call.

**Fetch options.** Every action that calls the server takes optional fetch options as its last argument (`Record<string, any>`, passed to Better Auth's fetch: `headers`, `onSuccess`, ...).

**Session refresh.** On success, `signInWithTelegram`, `linkTelegram`, `unlinkTelegram`, `signInWithMiniApp` and `autoSignInFromMiniApp` tell `useSession()` to reload, as Better Auth's own actions do. Pass `disableSignal: true` in the fetch options to skip it. The generated route calls (for example `authClient.telegram.signin(...)`) do the same.

### `signInWithTelegram(authData, fetchOptions?)`

Signs in with Login Widget data. Calls `POST /telegram/signin`.

| Parameter | Type |
|---|---|
| `authData` | `TelegramAuthData`, exactly as Telegram sent it |
| `fetchOptions` | optional |

**Returns:** `{ data: TelegramSignInResponse, error }`. `data` is `{ user, session }`.

### `linkTelegram(authData, fetchOptions?)`

Links Login Widget data to the signed-in user. Calls `POST /telegram/link`.

**Returns:** `{ data: TelegramLinkResponse, error }`. `data` is `{ success: true, message: "Telegram account linked successfully" }`.

### `unlinkTelegram(fetchOptions?)`

Removes the Login Widget / Mini App Telegram account from the signed-in user. Calls `POST /telegram/unlink`.

**Returns:** `{ data: TelegramLinkResponse, error }`. `data` is `{ success: true, message: "Telegram account unlinked successfully" }`.

### `getTelegramConfig(fetchOptions?)`

Calls `GET /telegram/config`.

**Returns:** `{ data: { botUsername, loginWidgetEnabled, miniAppEnabled, oidcEnabled, testMode }, error }`.

### `initTelegramWidget(container, options?, onAuth)`

Shows the Login Widget in callback mode.

| Parameter | Type | Description |
|---|---|---|
| `container` | `string \| HTMLElement` | The element, or its `id`. Its contents are replaced. |
| `options` | `TelegramWidgetOptions` | Appearance. Default `{}`. |
| `onAuth` | `(authData: TelegramAuthData) => void \| Promise<void>` | Called with Telegram's data after the user confirms. Errors it throws are logged to the console. |

**Steps:** loads `https://telegram.org/js/telegram-widget.js?24` (once, even if two widgets start at the same time), fetches `/telegram/config`, renders the widget.

**Returns:** `Promise<TelegramWidget>`. `destroy()` removes the widget's script, the iframe Telegram rendered and the global callback; a widget rendered later into the same container is unaffected. The user can sign in again without a page reload until you call `destroy()`.

**Throws:** `Failed to load Telegram widget script`, `Failed to get Telegram config`, `Telegram plugin: botUsername is required` (the server has no `botUsername`), `Container with id "<id>" not found`.

### `initTelegramWidgetRedirect(container, redirectUrl, options?)`

Shows the Login Widget in redirect mode: after confirming, Telegram sends the browser to `redirectUrl` with the data in the query string (`id`, `first_name`, `last_name`, `username`, `photo_url`, `auth_date`, `hash`, only those Telegram has).

**Returns:** `Promise<TelegramWidget>`. **Throws:** as `initTelegramWidget`.

### `signInWithMiniApp(initData, fetchOptions?)`

Signs in with the raw `initData` string (`window.Telegram.WebApp.initData`). Calls `POST /telegram/miniapp/signin`.

**Returns:** `{ data: TelegramSignInResponse, error }`.

### `validateMiniApp(initData, fetchOptions?)`

Checks `initData` without signing in. Calls `POST /telegram/miniapp/validate`.

**Returns:** `{ data: { valid: boolean, data: TelegramMiniAppData | null }, error }`. Invalid data is `{ valid: false, data: null }`, not an error.

### `autoSignInFromMiniApp(fetchOptions?)`

Reads `initData` from `window.Telegram.WebApp.initData`, or else from the `tgWebAppData` parameter in the URL fragment, and signs in like `signInWithMiniApp`.

**Throws:** `This method can only be called in browser` (no `window`), `Not running in Telegram Mini App or initData not available` (no `initData` in either place).

### `signInWithTelegramOIDC(options?, fetchOptions?)`

Starts OIDC sign-in. Calls `POST /sign-in/social` with `provider: "telegram-oidc"`; Better Auth's client then sends the browser to Telegram.

| Parameter | Type | Description |
|---|---|---|
| `options.callbackURL` | `string` | Where to go after signing in. |
| `options.errorCallbackURL` | `string` | Where to go if sign-in fails (with `?error=<code>`). |

**Returns:** `{ data: { url, redirect }, error }`. For more options (`newUserCallbackURL`, `idToken`, ...) call `authClient.signIn.social({ provider: "telegram-oidc", ... })` directly; to link, `authClient.linkSocial({ provider: "telegram-oidc" })`.

## Types

### `TelegramPluginOptions`

```ts
interface TelegramPluginOptions {
  botToken?: string;
  botUsername?: string;
  loginWidget?: boolean; // default true
  allowUserToLink?: boolean; // default true
  autoCreateUser?: boolean; // default true
  maxAuthAge?: number; // seconds, default 86400
  mapTelegramDataToUser?: (data: TelegramAuthData) => UserData;
  miniApp?: {
    enabled?: boolean; // default false
    validateInitData?: boolean; // default true
    allowAutoSignin?: boolean; // default true
    mapMiniAppDataToUser?: (data: TelegramMiniAppUser) => UserData;
  };
  oidc?: TelegramOIDCOptions;
  testMode?: boolean; // default false
}

// What every mapper returns: merged over the defaults
type UserData = {
  name?: string;
  email?: string;
  image?: string;
  [key: string]: any;
};
```

### `TelegramOIDCOptions`

```ts
interface TelegramOIDCOptions {
  enabled?: boolean; // default false
  clientId?: string; // default: bot ID from botToken
  clientSecret?: string; // required for OIDC sign-in; NOT the bot token
  scopes?: string[]; // added to "openid", "profile"
  disableDefaultScope?: boolean; // default false: don't request "profile"
  requestPhone?: boolean; // default false: adds "phone"
  requestBotAccess?: boolean; // default false: adds "telegram:bot_access"
  disableSignUp?: boolean; // default false
  disableIdTokenSignIn?: boolean; // default false
  mapOIDCProfileToUser?: (claims: TelegramOIDCClaims) => UserData;
}
```

### `TelegramAuthData`

Login Widget data.

```ts
interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number; // Unix time
  hash: string; // HMAC-SHA-256, hex
}
```

### `TelegramMiniAppData`

Parsed `initData`.

```ts
interface TelegramMiniAppData {
  auth_date: number;
  hash: string;
  user?: TelegramMiniAppUser;
  receiver?: TelegramMiniAppUser;
  chat?: TelegramMiniAppChat;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  chat_instance?: string;
  chat_join_request_query_id?: string; // opened from a chat join request
  start_param?: string;
  can_send_after?: number;
  query_id?: string;
  signature?: string; // Ed25519, for third-party validation (not checked by the plugin)
}
```

### `TelegramMiniAppUser`

```ts
interface TelegramMiniAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  is_bot?: boolean;
  added_to_attachment_menu?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}
```

### `TelegramMiniAppChat`

```ts
interface TelegramMiniAppChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  photo_url?: string;
}
```

### `TelegramOIDCClaims`

The verified ID-token claims.

```ts
interface TelegramOIDCClaims {
  iss: string; // "https://oauth.telegram.org"
  aud: string; // your Client ID
  sub: string; // per-bot user identifier, NOT the Telegram user ID
  iat: number;
  exp: number; // Telegram's tokens live 30 seconds
  nonce?: string;
  id?: string; // Telegram user ID, sent as a string ("8306595751"); needs "profile"
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string; // Telegram username
  picture?: string;
  phone_number?: string; // digits only, no "+"; needs "phone"
  phone_number_verified?: boolean;
}
```

Profile claims (`id`, names, `picture`, `preferred_username`) need the `profile` scope, and Telegram leaves them out for bots that sign with EdDSA or ES256K.

### `TelegramAccountRecord`

An account row as the Better Auth adapter returns it.

```ts
interface TelegramAccountRecord {
  id: string;
  userId: string;
  providerId: string;
  accountId: string;
  telegramId?: string;
  telegramUsername?: string;
}
```

### `TelegramWidgetOptions` and `TelegramWidget`

```ts
interface TelegramWidgetOptions {
  size?: "large" | "medium" | "small"; // default "large"
  showUserPhoto?: boolean; // default true
  cornerRadius?: number; // default 20
  requestAccess?: boolean; // default false: also ask to let the bot message the user
  lang?: string; // not set by default
}

interface TelegramWidget {
  destroy: () => void;
}
```

### Response types

```ts
type TelegramUser = User & {
  telegramId?: string | null;
  telegramUsername?: string | null;
  telegramPhoneNumber?: string | null;
};

interface TelegramSignInResponse {
  user: TelegramUser;
  session: Session;
}

interface TelegramLinkResponse {
  success: boolean;
  message: string;
}

interface TelegramClientError {
  code?: string;
  message?: string;
}
```

`User` and `Session` are Better Auth's types. Fields marked `returned: false` in your Better Auth config are left out of responses, as in Better Auth's own sign-in responses.

## Endpoints

Paths are relative to Better Auth's base path (`/api/auth` by default), so `/telegram/signin` is `/api/auth/telegram/signin`. Better Auth's own codes (`UNAUTHORIZED`, `INVALID_ORIGIN`, ...) are listed under [Better Auth codes](#better-auth-codes-you-may-see).

| Method | Path | Session | Exists when |
|---|---|---|---|
| POST | `/telegram/signin` | no | Login Widget on (default) |
| POST | `/telegram/link` | yes | Login Widget on |
| POST | `/telegram/unlink` | yes, fresh | Login Widget on |
| GET | `/telegram/config` | no | always |
| POST | `/telegram/miniapp/signin` | no | `miniApp.enabled` |
| POST | `/telegram/miniapp/validate` | no | `miniApp.enabled` |

### `POST /telegram/signin`

Signs in, or creates, a user with Login Widget data. Sets the session cookie.

**Body:** `TelegramAuthData`.

```json
{ "id": 8306595751, "first_name": "Ada", "username": "ada", "auth_date": 1761742302, "hash": "<64 hex characters>" }
```

**Response 200:** `{ "user": { ... }, "session": { ... } }`.

**How the user is found:**

1. The `telegram` account with this Telegram ID: sign in as its user. (Duplicate rows left by older versions are tolerated.)
2. A user whose `telegramId` matches, for example from OIDC: link a `telegram` account to them in a transaction, then sign in. Refused with 401 `ACCOUNT_NOT_LINKED` if `account.accountLinking.enabled` is `false` or `disableImplicitLinking` is `true`.
3. Otherwise, if `autoCreateUser`: create the user and account in a transaction, with the [default user data](./configuration.md#custom-user-data) and the mapper's result.

Each step calls `user.validateUserInfo` with `source.method: "telegram-login-widget"` and action `"sign-in"`, `"link-account"` or `"create-user"`. Every sign-in refreshes `telegramUsername` on the user and the account (and clears it when Telegram sends none). Sign-ins of the same Telegram ID run one at a time per Better Auth instance. Browser requests from untrusted origins are refused (Better Auth's `formCsrfMiddleware`).

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_AUTH_DATA` | `id`, `first_name`, `auth_date` or `hash` missing or of the wrong type |
| 401 | `INVALID_AUTHENTICATION` | Signature wrong, a field contains a line break, `hash` not 64 lowercase hex, `auth_date` older than `maxAuthAge` or more than 60 s in the future |
| 401 | `ACCOUNT_NOT_LINKED` | Step 2 not allowed by Better Auth's account-linking settings |
| 401 | `FAILED_TO_CREATE_SESSION` | A database hook refused the session |
| 403 | `INVALID_ORIGIN` | Browser request from an untrusted origin |
| 403 | your code / `validation_failed` | `user.validateUserInfo` refused / threw |
| 403 | `USER_CREATION_REJECTED` | A database hook refused the new user |
| 403 | `ACCOUNT_CREATION_REJECTED` | A database hook refused the Telegram account |
| 404 | `USER_CREATION_DISABLED` | No such user and `autoCreateUser: false` |
| 422 | `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` | The email your mapper returned belongs to another user |
| 500 | `BOT_TOKEN_REQUIRED` | No `botToken` |
| 500 | `ORPHANED_ACCOUNT` | The `telegram` account points to a deleted user |

### `POST /telegram/link`

Links Login Widget data to the signed-in user (`sessionMiddleware`). Calls `user.validateUserInfo` with action `"link-account"`; writes the account and the user's `telegramId` / `telegramUsername` in a transaction; then renews the session cookie so `session.cookieCache` shows the change.

**Body:** `TelegramAuthData`. **Response 200:** `{ "success": true, "message": "Telegram account linked successfully" }`.

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_AUTH_DATA` | As for sign-in |
| 401 | `INVALID_AUTHENTICATION` | As for sign-in |
| 401 | `UNAUTHORIZED` | No session |
| 403 | `LINKING_DISABLED` | `allowUserToLink: false`, or `account.accountLinking.enabled: false` |
| 403 | `ACCOUNT_CREATION_REJECTED` / `IDENTITY_UPDATE_REJECTED` | A hook refused the account or required profile update |
| 403 | your code / `validation_failed` | `user.validateUserInfo` refused / threw |
| 409 | `TELEGRAM_ALREADY_LINKED_OTHER` | Another user has this Telegram account, or this `telegramId` on their profile |
| 409 | `TELEGRAM_ALREADY_LINKED_SELF` | Already linked to this user |
| 409 | `DIFFERENT_TELEGRAM_ACCOUNT_LINKED` | This user already has a different Telegram ID |
| 500 | `BOT_TOKEN_REQUIRED` | No `botToken` |

### `POST /telegram/unlink`

Removes the user's `telegram` account. Needs a fresh session (`freshSessionMiddleware`, like Better Auth's `/unlink-account`). Afterwards `user.telegramId` is re-checked: kept if a remaining Telegram account (a `telegram-oidc` account with `account.telegramId`) proves it, switched to one that proves another ID, otherwise cleared together with `telegramUsername` and `telegramPhoneNumber`. The session cookie is renewed. The same re-check runs from a database hook whenever any `telegram` or `telegram-oidc` account is deleted through Better Auth. (OIDC accounts created before v3 have no `account.telegramId` until their next OIDC sign-in.)

**Body:** none. **Response 200:** `{ "success": true, "message": "Telegram account unlinked successfully" }`.

| Status | Code | When |
|---|---|---|
| 400 | `CANNOT_UNLINK_LAST_ACCOUNT` | It's the user's only account and `account.accountLinking.allowUnlinkingAll` isn't `true` |
| 401 | `UNAUTHORIZED` | No session |
| 403 | `SESSION_NOT_FRESH` | Session older than `session.freshAge` (default 1 day) |
| 403 | `ACCOUNT_UNLINK_REJECTED` / `IDENTITY_UPDATE_REJECTED` | Account removal or identity reconciliation was vetoed |
| 404 | `NOT_LINKED` | The user has no `telegram` account |

### `GET /telegram/config`

Public configuration for the client.

```json
{ "botUsername": "my_app_login_bot", "loginWidgetEnabled": true, "miniAppEnabled": false, "oidcEnabled": false, "testMode": false }
```

### `POST /telegram/miniapp/signin`

Signs in, or creates, a user from Mini App `initData`. Sets the session cookie. The same lookup, provisioning, username refresh and origin check as `/telegram/signin`, with `source.method: "telegram-mini-app"`. The user is `initData.user`, never `receiver`. New users are created only when `autoCreateUser` and `miniApp.allowAutoSignin` are both `true`. With `miniApp.validateInitData: false`, the signature isn't checked and no `botToken` is needed.

**Body:** `{ "initData": "query_id=...&user=...&auth_date=...&signature=...&hash=..." }`. **Response 200:** `{ "user": { ... }, "session": { ... } }`.

| Status | Code | When |
|---|---|---|
| 400 | `INIT_DATA_REQUIRED` | `initData` missing or not a string |
| 400 | `INVALID_MINI_APP_DATA_STRUCTURE` | No numeric `auth_date` or no `hash`, or `user` without numeric `id` / text `first_name` |
| 400 | `NO_USER_IN_INIT_DATA` | No `user` in `initData` |
| 401 | `INVALID_MINI_APP_INIT_DATA` | Signature wrong, `hash` not 64 lowercase hex, `auth_date` too old or more than 60 s in the future |
| 401 | `ACCOUNT_NOT_LINKED` | As for `/telegram/signin` |
| 401 | `FAILED_TO_CREATE_SESSION` | A database hook refused the session |
| 403 | `INVALID_ORIGIN` | Browser request from an untrusted origin |
| 403 | your code / `validation_failed` | `user.validateUserInfo` refused / threw |
| 403 | `USER_CREATION_REJECTED` | A database hook refused the new user |
| 403 | `ACCOUNT_CREATION_REJECTED` | A database hook refused the Telegram account |
| 404 | `MINI_APP_AUTO_SIGNIN_DISABLED` | No such user, and `autoCreateUser` or `miniApp.allowAutoSignin` is `false` |
| 422 | `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` | As for `/telegram/signin` |
| 500 | `BOT_TOKEN_REQUIRED` | No `botToken` (and `validateInitData` is on) |
| 500 | `ORPHANED_ACCOUNT` | As for `/telegram/signin` |

### `POST /telegram/miniapp/validate`

Checks `initData` without signing in. Always checks the signature, whatever `miniApp.validateInitData` says.

**Body:** `{ "initData": "..." }`.

**Response 200:** `{ "valid": true, "data": { "auth_date": 1761742302, "user": { "id": 8306595751, "first_name": "Ada" }, "hash": "..." } }`, or `{ "valid": false, "data": null }`.

| Status | Code | When |
|---|---|---|
| 400 | `INIT_DATA_REQUIRED` | `initData` missing or not a string |
| 500 | `BOT_TOKEN_REQUIRED` | No `botToken` |

## OIDC routes

OIDC uses Better Auth's built-in social sign-in routes with the provider `telegram-oidc`:

| Route | Purpose |
|---|---|
| `POST /sign-in/social` `{ provider: "telegram-oidc", callbackURL }` | Starts the Authorization Code flow with PKCE, `state` and a nonce. 500 `OIDC_CLIENT_SECRET_REQUIRED` / `OIDC_CLIENT_ID_REQUIRED` when credentials are missing. |
| `GET /callback/telegram-oidc` | Telegram's redirect target. Exchanges the code (HTTP Basic client authentication), verifies the ID token, creates or finds the user, sets the session. On failure redirects with `?error=`: `invalid_code` (exchange failed, including Telegram's HTTP-200 errors), `unable_to_get_user_info` (ID token refused), `signup_disabled` (`oidc.disableSignUp`). |
| `POST /sign-in/social` `{ provider: "telegram-oidc", idToken: { token, nonce } }` | Signs in with an existing ID token, verified the same way; the nonce is required. 401 if the token is refused, 404 `ID_TOKEN_NOT_SUPPORTED` with `oidc.disableIdTokenSignIn`. |
| `POST /link-social` `{ provider: "telegram-oidc" }` | Links Telegram OIDC to the signed-in user. Needs `trustedProviders` and `allowDifferentEmails` ([details](./oidc.md#link-telegram-oidc-to-a-signed-in-user)). |

With the Telegram columns, verified `id`, `preferred_username` and `phone_number` are copied to the user (and `id`, `preferred_username` to the `telegram-oidc` account) after OIDC sign-ups, sign-ins and links, only for the user who owns the account for that `sub`. Known limitations are listed in [OIDC](./oidc.md#known-limitations).

## Error codes

`TELEGRAM_ERROR_CODES` (from either entry) maps each code to `{ code, message }`:

```ts
import { TELEGRAM_ERROR_CODES } from "better-auth-telegram/client";

TELEGRAM_ERROR_CODES.CANNOT_UNLINK_LAST_ACCOUNT.code; // "CANNOT_UNLINK_LAST_ACCOUNT"
```

| Code | Status | Message | Where |
|---|---|---|---|
| `BOT_TOKEN_REQUIRED` | 500 | Telegram plugin: botToken is required | Login Widget and Mini App endpoints |
| `BOT_USERNAME_REQUIRED` | none | Telegram plugin: botUsername is required | Startup warning only; the client throws a plain `Error` with this message |
| `OIDC_CLIENT_ID_REQUIRED` | 500 | Telegram OIDC: oidc.clientId (or botToken) is required before starting an OIDC login | OIDC sign-in |
| `OIDC_CLIENT_SECRET_REQUIRED` | 500 | Telegram OIDC: oidc.clientSecret is required before starting an OIDC login. It is the Client Secret shown in @BotFather (your bot > Login Widget), not the bot token | OIDC sign-in |
| `INVALID_AUTH_DATA` | 400 | Invalid Telegram auth data | signin, link |
| `INVALID_AUTHENTICATION` | 401 | Invalid Telegram authentication | signin, link |
| `USER_CREATION_DISABLED` | 404 | User not found and auto-create is disabled | signin |
| `NOT_AUTHENTICATED` | none | Not authenticated | Defined, never returned (a missing session is Better Auth's 401 `UNAUTHORIZED`) |
| `LINKING_DISABLED` | 403 | Linking Telegram accounts is disabled | link |
| `TELEGRAM_ALREADY_LINKED_OTHER` | 409 | This Telegram account is already linked to another user | link |
| `TELEGRAM_ALREADY_LINKED_SELF` | 409 | This Telegram account is already linked to your account | link |
| `NOT_LINKED` | 404 | No Telegram account linked | unlink |
| `DIFFERENT_TELEGRAM_ACCOUNT_LINKED` | 409 | A different Telegram account is already linked to your account | link |
| `ACCOUNT_NOT_LINKED` | 401 | A user with this Telegram account exists, but the account is not linked and account linking does not allow linking it on sign-in | signin, miniapp/signin |
| `CANNOT_UNLINK_LAST_ACCOUNT` | 400 | Cannot unlink Telegram: it is the only way to sign in to this account | unlink |
| `USER_CREATION_REJECTED` | 403 | User creation was rejected | signin, miniapp/signin |
| `ORPHANED_ACCOUNT` | 500 | Telegram account references a user that does not exist | signin, miniapp/signin |
| `INIT_DATA_REQUIRED` | 400 | initData is required and must be a string | miniapp/signin, miniapp/validate |
| `INVALID_MINI_APP_INIT_DATA` | 401 | Invalid Mini App initData | miniapp/signin |
| `INVALID_MINI_APP_DATA_STRUCTURE` | 400 | Invalid Mini App data structure | miniapp/signin |
| `NO_USER_IN_INIT_DATA` | 400 | No user data in initData | miniapp/signin |
| `MINI_APP_AUTO_SIGNIN_DISABLED` | 404 | User not found and auto-signin is disabled for Mini Apps | miniapp/signin |
| `PLACEHOLDER_EMAIL_RESERVED` | 400 | Telegram placeholder email addresses are reserved for Telegram sign-in | Any route that changes a user's email (for example `/change-email`) |

### Better Auth codes you may see

| Code | Status | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | `/telegram/link` or `/telegram/unlink` without a session |
| `SESSION_NOT_FRESH` | 403 | `/telegram/unlink` with an old session |
| `INVALID_ORIGIN` | 403 | Sign-in from an untrusted origin |
| `validation_failed` | 403 | `user.validateUserInfo` threw |
| `FAILED_TO_CREATE_SESSION` | 401 | A database hook refused the session |
| `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` | 422 | The new user's email is taken |
| `BANNED_USER` | 403 | Better Auth's admin plugin: the user is banned |
| `ID_TOKEN_NOT_SUPPORTED` | 404 | ID-token sign-in with `oidc.disableIdTokenSignIn` |

## Rate limits

| Endpoint | Requests | Window |
|---|---|---|
| `/telegram/signin` | 10 | 60 s |
| `/telegram/link` | 5 | 60 s |
| `/telegram/unlink` | 5 | 60 s |
| `/telegram/miniapp/signin` | 10 | 60 s |
| `/telegram/miniapp/validate` | 20 | 60 s |

Registered only for enabled endpoints. Enforced by Better Auth's rate limiter, which is on in production by default and stores counts in process memory unless configured otherwise. See [Security: rate limits](./security.md#rate-limits).

## Database schema

Added only when the Login Widget or Mini App is enabled. All fields are optional (nullable) strings, and all must exist in the database.

**`user`**

| Field | Index | `input` | Filled from |
|---|---|---|---|
| `telegramId` | yes | `false` | Login Widget / Mini App user ID; the OIDC `id` claim |
| `telegramUsername` | no | `false` | Telegram username; OIDC `preferred_username`. Refreshed on every sign-in. |
| `telegramPhoneNumber` | no | `false` | OIDC `phone_number` (with `oidc.requestPhone`) |

**`account`**

| Field | Filled from |
|---|---|
| `telegramId` | `telegram` accounts: the Telegram user ID. `telegram-oidc` accounts: the verified `id` claim. |
| `telegramUsername` | The Telegram username at the last sign-in. |

`input: false` means users can't set these fields through Better Auth's API, and Better Auth also drops them from mapper output. The account fields are what keep `user.telegramId` honest: when a Telegram account is deleted, the user keeps only a `telegramId` that a remaining Telegram account still proves.

Placeholder email domains: `telegram.placeholder.invalid` (Login Widget, Mini App) and `telegram-oidc.placeholder.invalid` (OIDC). See [Installation: placeholder emails](./installation.md#placeholder-emails).
