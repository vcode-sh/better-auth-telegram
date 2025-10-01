# API Reference

Complete API reference for the better-auth-telegram plugin.

## Table of Contents

- [Server Plugin](#server-plugin)
- [Client Plugin](#client-plugin)
- [Types](#types)
- [Endpoints](#endpoints)

## Server Plugin

### `telegram(options)`

The main server plugin function.

```typescript
import { telegram } from "better-auth-telegram";

const plugin = telegram({
  botToken: string,
  botUsername: string,
  allowUserToLink?: boolean,
  autoCreateUser?: boolean,
  maxAuthAge?: number,
  mapTelegramDataToUser?: (data: TelegramAuthData) => UserData,
});
```

#### Parameters

##### `botToken` (required)

- **Type:** `string`
- **Description:** Your Telegram bot token from @BotFather
- **Example:** `"1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"`

##### `botUsername` (required)

- **Type:** `string`
- **Description:** Your bot's username without the @ symbol
- **Example:** `"my_auth_bot"`

##### `allowUserToLink` (optional)

- **Type:** `boolean`
- **Default:** `true`
- **Description:** Allow authenticated users to link their Telegram account
- **Example:** `false` to disable linking

##### `autoCreateUser` (optional)

- **Type:** `boolean`
- **Default:** `true`
- **Description:** Automatically create a new user account if Telegram user doesn't exist
- **Example:** `false` to require manual user creation

##### `maxAuthAge` (optional)

- **Type:** `number` (seconds)
- **Default:** `86400` (24 hours)
- **Description:** Maximum age of `auth_date` to prevent replay attacks
- **Example:** `3600` for 1 hour

##### `mapTelegramDataToUser` (optional)

- **Type:** `(data: TelegramAuthData) => UserData`
- **Default:** Uses `username` or `first_name` for name, `photo_url` for image
- **Description:** Custom function to map Telegram data to user object
- **Example:**

```typescript
mapTelegramDataToUser: (data) => ({
  name: `${data.first_name} ${data.last_name || ""}`.trim(),
  email: undefined, // Telegram doesn't provide email
  image: data.photo_url,
  // Custom fields
  telegramVerified: true,
  displayName: data.username || data.first_name,
})
```

#### Returns

A Better Auth plugin object with:
- `id`: `"telegram"`
- `endpoints`: Authentication endpoints
- `schema`: Database schema extensions
- `hooks`: Session and authentication hooks

### Example Configuration

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* ... */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,
      allowUserToLink: true,
      autoCreateUser: true,
      maxAuthAge: 86400,
      mapTelegramDataToUser: (data) => ({
        name: data.username || data.first_name,
        image: data.photo_url,
        email: undefined,
      }),
    }),
  ],
});
```

## Client Plugin

### `telegramClient()`

The client-side plugin for Telegram authentication.

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [telegramClient()],
});
```

### Client Methods

#### `signInWithTelegram(authData)`

Sign in a user with Telegram authentication data.

```typescript
const result = await authClient.signInWithTelegram(authData);
```

**Parameters:**

- `authData`: `TelegramAuthData` - Authentication data from Telegram widget

**Returns:** `Promise<{ user?: User; session?: Session; error?: Error }>`

**Example:**

```typescript
const result = await authClient.signInWithTelegram({
  id: 123456789,
  first_name: "John",
  last_name: "Doe",
  username: "johndoe",
  photo_url: "https://...",
  auth_date: 1234567890,
  hash: "abc123...",
});

if (result.error) {
  console.error("Sign in failed:", result.error.message);
} else {
  console.log("Signed in:", result.user);
}
```

---

#### `linkTelegram(authData)`

Link a Telegram account to the currently authenticated user.

```typescript
await authClient.linkTelegram(authData);
```

**Parameters:**

- `authData`: `TelegramAuthData` - Authentication data from Telegram widget

**Returns:** `Promise<void>`

**Throws:** Error if user is not authenticated or linking fails

**Example:**

```typescript
try {
  await authClient.linkTelegram(authData);
  console.log("Telegram account linked successfully!");
} catch (error) {
  console.error("Failed to link:", error.message);
}
```

---

#### `unlinkTelegram()`

Unlink the Telegram account from the currently authenticated user.

```typescript
await authClient.unlinkTelegram();
```

**Parameters:** None

**Returns:** `Promise<void>`

**Throws:** Error if user is not authenticated or has no linked Telegram account

**Example:**

```typescript
try {
  await authClient.unlinkTelegram();
  console.log("Telegram account unlinked");
} catch (error) {
  console.error("Failed to unlink:", error.message);
}
```

---

#### `getTelegramConfig()`

Get the bot configuration (bot username).

```typescript
const config = await authClient.getTelegramConfig();
```

**Parameters:** None

**Returns:** `Promise<{ botUsername: string }>`

**Example:**

```typescript
const config = await authClient.getTelegramConfig();
console.log("Bot username:", config.botUsername);
```

---

#### `initTelegramWidget(containerId, options, onAuth)`

Initialize the Telegram login widget with a callback function.

```typescript
authClient.initTelegramWidget(containerId, options, onAuth);
```

**Parameters:**

- `containerId`: `string` - The HTML element ID where the widget will be rendered
- `options`: `TelegramWidgetOptions` - Widget configuration options
- `onAuth`: `(authData: TelegramAuthData) => void | Promise<void>` - Callback function called when user authenticates

**Returns:** `Promise<void>`

**Example:**

```typescript
await authClient.initTelegramWidget(
  "telegram-login-container",
  {
    size: "large",
    showUserPhoto: true,
    cornerRadius: 20,
    requestAccess: false,
    lang: "en",
  },
  async (authData) => {
    const result = await authClient.signInWithTelegram(authData);
    if (!result.error) {
      window.location.href = "/dashboard";
    }
  }
);
```

---

#### `initTelegramWidgetRedirect(containerId, redirectUrl, options)`

Initialize the Telegram login widget with redirect flow.

```typescript
authClient.initTelegramWidgetRedirect(containerId, redirectUrl, options);
```

**Parameters:**

- `containerId`: `string` - The HTML element ID where the widget will be rendered
- `redirectUrl`: `string` - URL to redirect to after authentication
- `options`: `TelegramWidgetOptions` - Widget configuration options

**Returns:** `Promise<void>`

**Example:**

```typescript
await authClient.initTelegramWidgetRedirect(
  "telegram-login-container",
  "/auth/telegram/callback",
  {
    size: "medium",
    showUserPhoto: true,
  }
);
```

## Types

### `TelegramAuthData`

Authentication data returned by Telegram.

```typescript
interface TelegramAuthData {
  /**
   * Telegram user ID
   */
  id: number;

  /**
   * User's first name
   */
  first_name: string;

  /**
   * User's last name (optional)
   */
  last_name?: string;

  /**
   * User's username (optional)
   */
  username?: string;

  /**
   * URL of user's profile photo (optional)
   */
  photo_url?: string;

  /**
   * Unix timestamp of authentication
   */
  auth_date: number;

  /**
   * HMAC-SHA-256 hash for verification
   */
  hash: string;
}
```

### `TelegramPluginOptions`

Server plugin configuration options.

```typescript
interface TelegramPluginOptions {
  /**
   * Bot token from @BotFather (required)
   */
  botToken: string;

  /**
   * Bot username without @ (required)
   */
  botUsername: string;

  /**
   * Allow users to link Telegram to existing accounts
   * @default true
   */
  allowUserToLink?: boolean;

  /**
   * Automatically create user if doesn't exist
   * @default true
   */
  autoCreateUser?: boolean;

  /**
   * Maximum age of auth_date in seconds
   * @default 86400 (24 hours)
   */
  maxAuthAge?: number;

  /**
   * Custom function to map Telegram data to user object
   */
  mapTelegramDataToUser?: (data: TelegramAuthData) => {
    name?: string;
    email?: string;
    image?: string;
    [key: string]: any;
  };
}
```

### `TelegramWidgetOptions`

Client widget configuration options.

```typescript
interface TelegramWidgetOptions {
  /**
   * Button size
   * @default "large"
   */
  size?: "large" | "medium" | "small";

  /**
   * Show user photo in button
   * @default true
   */
  showUserPhoto?: boolean;

  /**
   * Button corner radius in pixels
   * @default 20
   */
  cornerRadius?: number;

  /**
   * Request write access permission
   * @default false
   */
  requestAccess?: boolean;

  /**
   * Language code (e.g., "en", "pl", "ru")
   * @default User's language
   */
  lang?: string;
}
```

## Endpoints

The plugin adds the following HTTP endpoints to your Better Auth instance:

### `POST /api/auth/telegram/signin`

Sign in or create a user with Telegram authentication.

**Request Body:**

```json
{
  "id": 123456789,
  "first_name": "John",
  "last_name": "Doe",
  "username": "johndoe",
  "photo_url": "https://...",
  "auth_date": 1234567890,
  "hash": "abc123..."
}
```

**Response (Success - 200):**

```json
{
  "user": {
    "id": "user_123",
    "name": "John Doe",
    "email": null,
    "image": "https://...",
    "telegramId": "123456789",
    "telegramUsername": "johndoe"
  },
  "session": {
    "id": "session_456",
    "userId": "user_123",
    "expiresAt": "2024-01-01T00:00:00.000Z",
    "token": "..."
  }
}
```

**Response (Error - 400):**

```json
{
  "error": "Invalid authentication data",
  "message": "HMAC verification failed"
}
```

---

### `POST /api/auth/telegram/link`

Link a Telegram account to the authenticated user.

**Headers:**
- `Authorization: Bearer <session_token>` or session cookie

**Request Body:**

```json
{
  "id": 123456789,
  "first_name": "John",
  "username": "johndoe",
  "auth_date": 1234567890,
  "hash": "abc123..."
}
```

**Response (Success - 200):**

```json
{
  "success": true,
  "message": "Telegram account linked successfully"
}
```

**Response (Error - 401):**

```json
{
  "error": "Unauthorized",
  "message": "You must be signed in to link a Telegram account"
}
```

**Response (Error - 400):**

```json
{
  "error": "Already linked",
  "message": "This Telegram account is already linked to another user"
}
```

---

### `POST /api/auth/telegram/unlink`

Unlink the Telegram account from the authenticated user.

**Headers:**
- `Authorization: Bearer <session_token>` or session cookie

**Request Body:** None (empty)

**Response (Success - 200):**

```json
{
  "success": true,
  "message": "Telegram account unlinked successfully"
}
```

**Response (Error - 401):**

```json
{
  "error": "Unauthorized",
  "message": "You must be signed in to unlink a Telegram account"
}
```

**Response (Error - 400):**

```json
{
  "error": "No linked account",
  "message": "No Telegram account is linked to this user"
}
```

---

### `GET /api/auth/telegram/config`

Get the bot configuration.

**Parameters:** None

**Response (Success - 200):**

```json
{
  "botUsername": "my_auth_bot"
}
```

## Error Handling

All endpoints follow Better Auth's error handling conventions:

```typescript
{
  error: string;      // Error type/code
  message: string;    // Human-readable error message
  status?: number;    // HTTP status code
}
```

Common error codes:

- `400` - Bad Request (invalid data, verification failed)
- `401` - Unauthorized (not authenticated)
- `403` - Forbidden (action not allowed)
- `409` - Conflict (account already linked)
- `500` - Internal Server Error

## Schema Extensions

The plugin extends Better Auth's database schema:

### User Table

Additional fields:

```typescript
{
  telegramId?: string;       // Telegram user ID as string
  telegramUsername?: string; // Telegram username
}
```

### Account Table

Additional fields:

```typescript
{
  telegramId?: string;       // Telegram user ID as string
  telegramUsername?: string; // Telegram username
}
```

## Hooks

The plugin provides internal hooks for customization (advanced usage):

### `session.init`

Called when a session is created via Telegram authentication.

### `user.created`

Called when a new user is created via Telegram sign-in.

## Next Steps

- [Usage Examples](./usage.md)
- [Configuration Guide](./configuration.md)
- [Security Best Practices](./security.md)
- [Troubleshooting](./troubleshooting.md)
