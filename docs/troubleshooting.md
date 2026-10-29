# Troubleshooting

Find what you see, then follow the fix. Each entry is: **what you see**, why it happens, and what to do.

**Two quick checks solve many problems:**

1. Look at your server log when it starts. Lines starting with `[better-auth-telegram]` describe configuration problems ([list](./configuration.md#startup-warnings)).
2. Open your browser's developer tools, **Network** tab, and click the failing request. The response body has a `code` (like `INVALID_ORIGIN`) and a `message`.

## Find your error code

| Code (status) | Section |
|---|---|
| schema mismatch (500) | [Every auth request fails with 500](#every-auth-request-fails-with-500-schema-mismatch) |
| `BOT_TOKEN_REQUIRED` (500) | [500 BOT_TOKEN_REQUIRED](#500-bot_token_required) |
| `INVALID_AUTH_DATA` (400) | [400 INVALID_AUTH_DATA](#400-invalid_auth_data) |
| `INVALID_AUTHENTICATION` (401) | [401 INVALID_AUTHENTICATION](#401-invalid_authentication) |
| `INVALID_ORIGIN` (403) | [403 INVALID_ORIGIN](#403-invalid_origin) |
| `USER_CREATION_DISABLED`, `MINI_APP_AUTO_SIGNIN_DISABLED` (404) | [404: user not found](#404-user-not-found-and-auto-create-is-disabled) |
| `ACCOUNT_NOT_LINKED` (401) | [401 ACCOUNT_NOT_LINKED](#401-account_not_linked) |
| your own code, `validation_failed` (403) | [403 from your validateUserInfo](#403-with-your-own-code-or-validation_failed) |
| `USER_CREATION_REJECTED` (403) | [403 USER_CREATION_REJECTED](#403-user_creation_rejected) |
| `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (422) | [422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL](#422-user_already_exists_use_another_email) |
| `FAILED_TO_CREATE_SESSION` (401) | [401 FAILED_TO_CREATE_SESSION](#401-failed_to_create_session) |
| `ORPHANED_ACCOUNT` (500) | [500 ORPHANED_ACCOUNT](#500-orphaned_account) |
| `PLACEHOLDER_EMAIL_RESERVED` (400) | [400 PLACEHOLDER_EMAIL_RESERVED](#400-placeholder_email_reserved) |
| `UNAUTHORIZED` (401) on link or unlink | [401 UNAUTHORIZED when linking or unlinking](#401-unauthorized-when-linking-or-unlinking) |
| `LINKING_DISABLED` (403) | [403 LINKING_DISABLED](#403-linking_disabled) |
| `TELEGRAM_ALREADY_LINKED_OTHER`, `TELEGRAM_ALREADY_LINKED_SELF`, `DIFFERENT_TELEGRAM_ACCOUNT_LINKED` (409) | [409 when linking](#409-when-linking) |
| `NOT_LINKED` (404) | [404 NOT_LINKED](#404-not_linked) |
| `CANNOT_UNLINK_LAST_ACCOUNT` (400) | [400 CANNOT_UNLINK_LAST_ACCOUNT](#400-cannot_unlink_last_account) |
| `SESSION_NOT_FRESH` (403) | [403 SESSION_NOT_FRESH](#403-session_not_fresh) |
| `INIT_DATA_REQUIRED`, `INVALID_MINI_APP_INIT_DATA`, `INVALID_MINI_APP_DATA_STRUCTURE`, `NO_USER_IN_INIT_DATA` | [Mini App](#mini-app) |
| `OIDC_CLIENT_SECRET_REQUIRED`, `OIDC_CLIENT_ID_REQUIRED` (500) | [500 OIDC_CLIENT_SECRET_REQUIRED](#500-oidc_client_secret_required-or-oidc_client_id_required) |
| `?error=invalid_code`, `unable_to_get_user_info`, `signup_disabled` in the URL | [OIDC](#oidc) |

## Setup and database

### Every auth request fails with 500 ("schema mismatch")

**What you see:** every Better Auth request answers 500, and the server log shows `Database schema mismatch` (or `Prisma schema mismatch`, `Drizzle schema mismatch`) with `Missing columns` such as `user.telegramId`.

**Why:** Better Auth 1.7.3 and newer checks that the database has every column it needs before answering any request. The plugin adds five columns when the Login Widget or Mini App is on.

**Fix:**

```bash
npx auth@1.7.14 migrate        # built-in Kysely adapter (pg, mysql2, SQLite)
npx auth@1.7.14 generate       # Prisma or Drizzle; then run your ORM's migration
npx auth@1.7.14 check schema   # should print "Schema check passed against the live database."
```

Upgrading from v2? Run it anyway: v3 adds an index on `user.telegramId`. In OIDC-only mode the plugin adds no columns, so a mismatch there comes from Better Auth's own tables. More: [Installation: database](./installation.md#3-update-your-database).

### 500 BOT_TOKEN_REQUIRED

**What you see:** Login Widget or Mini App requests answer 500 with `BOT_TOKEN_REQUIRED`, and the startup log warns about it.

**Why:** `botToken` is empty when the request arrives, usually because the environment variable isn't set where the server runs.

**Fix:** set `TELEGRAM_BOT_TOKEN` in the server's environment (also in production and in CI previews) and restart.

### A v2 sign-up failed with NOT NULL on `user.email`

**What you see:** with v2, the first Login Widget or Mini App sign-in on a SQL database failed with a NOT NULL or unique constraint error on `user.email`.

**Why:** v2 created these users without an email, which only worked with the in-memory adapter.

**Fix:** upgrade to v3. New users get a [placeholder email](./installation.md#placeholder-emails). See the [migration guide](./migration-v2-to-v3.md).

## Login Widget

### The Telegram button doesn't appear

Check these in order:

1. **The container exists when you call `initTelegramWidget`.** In React, call it in `useEffect` (after the element is rendered), not during render. If you pass an id, it must match the element's `id` exactly; otherwise the call throws `Container with id "..." not found`.
2. **The server knows the bot username.** Open `https://<your domain>/api/auth/telegram/config`. `botUsername` must be your bot's username without `@`. If it's empty, set `TELEGRAM_BOT_USERNAME`.
3. **The domain is linked to the bot.** Send `/setdomain` to BotFather with the domain you are on ([how](./telegram-bot-setup.md#login-widget)). If the button shows "Bot domain invalid", the domain doesn't match: check for a changed tunnel address, or `www.` versus no `www.`.
4. **You're on the public HTTPS address**, not `localhost`.
5. **Nothing blocks Telegram.** An ad blocker or a Content Security Policy can block the script. With a CSP, allow `https://telegram.org` in `script-src` and `https://oauth.telegram.org` in `frame-src` (the button is an iframe from that address).

### The button stopped working after setting up OIDC

**Why:** you switched this bot to OpenID Connect in BotFather. That permanently turns off the bot's Login Widget.

**Fix:** create a second bot for the Login Widget, run `/setdomain` for it, and put its token and username in `botToken` and `botUsername`. Keep the OIDC bot in `oidc.clientId` and `oidc.clientSecret`. See [the two-bot rule](./telegram-bot-setup.md#using-more-than-one-method).

### Clicking the button does nothing, or nothing happens after confirming

- Check the Network tab for a request to `/api/auth/telegram/signin`. If there is none, your `onAuth` callback isn't calling `signInWithTelegram`. Errors thrown inside your callback are logged to the browser console as `[better-auth-telegram] Telegram widget onAuth failed`.
- If there is one, its response tells you what went wrong; find the code in [the table above](#find-your-error-code).

### The button appears twice, or disappears after a hot reload

**Why:** the widget was created again without removing the old one.

**Fix:** keep the handle `initTelegramWidget` returns and call `destroy()` when the component unmounts. See the [React example](./usage.md#react-component).

### 400 INVALID_AUTH_DATA

**Why:** the data sent to `/telegram/signin` or `/telegram/link` is missing `id`, `first_name`, `auth_date` or `hash`, or has the wrong type.

**Fix:** pass the object Telegram gave you, unchanged. In [redirect mode](./usage.md#redirect-mode), convert `id` and `auth_date` from the query string to numbers.

### 401 INVALID_AUTHENTICATION

**Why:** the signature check failed or the data is too old. Common causes:

1. **Wrong bot token.** `TELEGRAM_BOT_TOKEN` belongs to a different bot than the button (`botUsername`). They must be the same bot.
2. **The token changed.** Data signed with an old token is refused. Start a fresh Telegram sign-in or reopen the Mini App. Existing Better Auth sessions are unaffected.
3. **The data was changed on the way.** You added, removed or changed a field (for example an empty `last_name`), or the hash isn't 64 lowercase hex characters, or a field contains a line break.
4. **The data is too old.** `auth_date` is older than `maxAuthAge` (24 hours by default). Common with a cached redirect page; sign in again.
5. **The server clock is wrong.** Data dated more than 60 seconds in the future is refused. Check the server's time (`date`), and enable time sync.

The plugin removes spaces and newlines around `botToken` and warns about it, so a stray newline in the env file is not the cause any more.

## Any sign-in method

### 403 INVALID_ORIGIN

**What you see:** sign-in answers 403 with `INVALID_ORIGIN`, and the server log shows `Invalid origin: https://...`.

**Why:** Better Auth only accepts sign-ins from trusted origins. `/telegram/signin` and `/telegram/miniapp/signin` check this even without cookies, to stop login CSRF.

**Fix:** make sure the page's origin is trusted:

- **In development with a tunnel:** set `BETTER_AUTH_URL` to the tunnel address and open the tunnel address, not `localhost` (or the other way round, but both must match).
- **Sign-in page or Mini App on another domain:** add it to `trustedOrigins`:

```ts
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  trustedOrigins: ["https://app.example.com"],
});
```

### 404: user not found and auto-create is disabled

**Codes:** `USER_CREATION_DISABLED` (Login Widget), `MINI_APP_AUTO_SIGNIN_DISABLED` (Mini App).

**Why:** this Telegram user has no account, and you turned off sign-up: `autoCreateUser: false`, or for Mini Apps `miniApp.allowAutoSignin: false`.

**Fix:** working as configured. To allow sign-ups, set both options to `true` (their default). Otherwise create the user first and let them link Telegram.

### 401 ACCOUNT_NOT_LINKED

**Why:** a user with this `telegramId` already exists (typically someone who signed up with OIDC), but their account isn't linked to the Login Widget or Mini App yet, and Better Auth's `account.accountLinking.enabled: false` or `disableImplicitLinking: true` forbids linking it automatically during sign-in. Better Auth applies the same rule to its own OAuth sign-ins.

**Fix:** remove that setting, or let the signed-in user link Telegram explicitly with `/telegram/link` (allowed with `disableImplicitLinking`, not with `enabled: false`).

### 403 with your own code, or validation_failed

**Why:** your `user.validateUserInfo` refused the sign-in. Since v3 it runs for every Login Widget and Mini App sign-up, sign-in and link, with `source.method` `"telegram-login-widget"` or `"telegram-mini-app"` and `source.action` `"create-user"`, `"sign-in"` or `"link-account"`. `validation_failed` means the function threw an error.

**Fix:** check your function's logic for these methods and actions, and fix the error it throws. Details: [Security: your hooks](./security.md#your-hooks-run-for-telegram-users).

### 403 USER_CREATION_REJECTED

**Why:** a `databaseHooks.user.create.before` hook returned `false` for the new Telegram user. Besides your own hooks, the plugin's hook refuses a Telegram placeholder email that doesn't belong to this sign-in, for example a mapper that returns another user's `<id>@telegram.placeholder.invalid`.

**Fix:** check your hooks and mapper. The server log has details.

### 422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL

**Why:** your mapper returned an email that another user already has. The plugin never links the Telegram user to that other user.

**Fix:** return emails that are unique, or none (then the plugin uses a placeholder).

### 401 FAILED_TO_CREATE_SESSION

**Why:** a `databaseHooks.session.create.before` hook refused the session (for example a ban check).

**Fix:** working as your hook decided. Check its logic if this is unexpected.

### 500 ORPHANED_ACCOUNT

**Why:** there is a `telegram` row in the `account` table whose `userId` points to a user that no longer exists. Something deleted the user without its accounts.

**Fix:** delete that account row.

### 400 PLACEHOLDER_EMAIL_RESERVED

**Why:** something tried to change a user's email to a Telegram placeholder (`...@telegram.placeholder.invalid` or `...@telegram-oidc.placeholder.invalid`), for example through `/change-email`. These addresses are reserved for Telegram sign-in; the same rule stops anyone from signing up with one.

**Fix:** use a real email address. To detect "no real email yet" in your UI, check whether the user's email ends in `.placeholder.invalid`.

## Sessions

### Signed in, but the page still shows "signed out"

- **The client updates `useSession()` by itself** after `signInWithTelegram`, `signInWithMiniApp`, `autoSignInFromMiniApp`, `linkTelegram` and `unlinkTelegram`. If you passed `disableSignal: true`, it doesn't.
- **Server-rendered pages** need a new request: after sign-in, navigate (for example `router.refresh()` in Next.js) or reload.
- **The cookie wasn't stored.** Check the sign-in response in the Network tab for a `Set-Cookie` header, and the browser's cookie storage. See the next entry.

### 401 UNAUTHORIZED when linking or unlinking

**Why:** the request reached the server without a session cookie. Better Auth's client already sends cookies with every request (`credentials: "include"`), so the cause is elsewhere:

1. **Nobody is signed in** in this browser, or the session expired.
2. **The client talks to another address** than the one that set the cookie. Check `baseURL` in `createAuthClient` and `BETTER_AUTH_URL` on the server.
3. **The site and the auth server are on different sites** (for example `myapp.com` and `myapp-api.com`). Browsers don't send `SameSite=Lax` cookies across sites. Serve both from the same site (for example `app.example.com` and `api.example.com`), or proxy `/api/auth` through your frontend's domain.
4. **Inside Telegram Web**, see [Mini Apps: cookies in an iframe](./miniapps.md#inside-telegram-web-cookies-in-an-iframe).

For different origins you also need CORS in your server framework (allow your frontend's origin with credentials) and that origin in `trustedOrigins`. Better Auth has no CORS option of its own.

### Telegram fields in the session are out of date

**Why:** with Better Auth's `session.cookieCache` on, the session comes from a cookie until the cache expires. The plugin's `/telegram/link` and `/telegram/unlink` renew the cookie right away, but Better Auth's `/link-social` and `/unlink-account` don't.

**Fix:** wait for the cache to expire, or ask for a fresh session: `authClient.getSession({ query: { disableCookieCache: true } })`.

## Linking and unlinking

### 403 LINKING_DISABLED

**Why:** `allowUserToLink: false` in the plugin, or `account.accountLinking.enabled: false` in Better Auth (which turns off all linking).

**Fix:** check both settings.

### 409 when linking

| Code | Meaning | What to do |
|---|---|---|
| `TELEGRAM_ALREADY_LINKED_OTHER` | This Telegram account belongs to another user (linked, or their profile already has this `telegramId`, for example from OIDC). | Unlink it from the other user first, or sign in as that user. |
| `TELEGRAM_ALREADY_LINKED_SELF` | It's already linked to this user. | Nothing; treat it as success. |
| `DIFFERENT_TELEGRAM_ACCOUNT_LINKED` | This user already has a different Telegram account. One per user. | Unlink the old Telegram account, then link the new one. |

### 404 NOT_LINKED

**Why:** `unlinkTelegram()` was called for a user without a Login Widget or Mini App Telegram account. (OIDC accounts are removed with Better Auth's `unlinkAccount`, using provider ID `telegram-oidc`.)

### 400 CANNOT_UNLINK_LAST_ACCOUNT

**Why:** Telegram is the user's only way to sign in. Removing it would lock them out.

**Fix:** ask the user to add another sign-in method first (password, another provider). To allow it anyway:

```ts
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  account: {
    accountLinking: { allowUnlinkingAll: true },
  },
});
```

### 403 SESSION_NOT_FRESH

**Why:** unlinking needs a recent sign-in. The session is older than `session.freshAge` (1 day by default). This is the same rule as Better Auth's `/unlink-account`.

**Fix:** ask the user to sign in again, then unlink. You can raise `session.freshAge`, but then older (possibly stolen) sessions can remove sign-in methods.

### An unlinked Telegram account can still sign in

This shouldn't happen: removing a Telegram account clears `user.telegramId` unless another Telegram account of that user still proves it. Check:

- **Another account still proves it.** For example the user also has a `telegram-oidc` account for the same Telegram user. Then the Telegram ID stays on purpose; unlink that account too.
- **The account row was deleted with SQL**, so no hook ran. Clear `user.telegramId` yourself.

## Mini App

The most common Mini App problems, briefly. Details in [Mini Apps: troubleshooting](./miniapps.md#troubleshooting).

| What you see | Why | Fix |
|---|---|---|
| `autoSignInFromMiniApp()` throws "Not running in Telegram Mini App or initData not available" | Opened in a normal browser, or launched from a keyboard button or inline mode (no `initData` there). | Open it from the bot's profile, menu button, an inline button or a `t.me` link. |
| 400 `INIT_DATA_REQUIRED` | `initData` was empty or not a string. | Pass `window.Telegram.WebApp.initData` as it is. |
| 401 `INVALID_MINI_APP_INIT_DATA` | Wrong bot token, data changed, older than `maxAuthAge`, or server clock wrong. | Use the token of the bot that owns the Mini App; send `initData` unchanged; reopen the app. |
| 400 `INVALID_MINI_APP_DATA_STRUCTURE` | `initData` has no valid `auth_date` or `hash`, or a malformed `user`. | Send the raw `initData` string, not `initDataUnsafe`. |
| 400 `NO_USER_IN_INIT_DATA` | `initData` has no `user`. | Launch the app in a way that includes the user (see first row). |
| Signed in, but the next request is signed out (Telegram Web) | Cookies are third-party inside the iframe. | [Cookie attributes or `bearer()`](./miniapps.md#inside-telegram-web-cookies-in-an-iframe). |

## OIDC

When OIDC sign-in fails after the user left your site, Better Auth sends the browser to your `errorCallbackURL` (or its error page) with `?error=<code>`. The server log has the details.

### `?error=invalid_code`

**Why:** exchanging the code with Telegram failed. Telegram answers errors with HTTP 200 and an `error` field; the server log line contains Telegram's error, for example `invalid_client`.

**Fix for `invalid_client`:** `oidc.clientSecret` must be the current Client Secret from BotFather (your bot > Login Widget), **not** the bot token. Check that `oidc.clientId` is that bot's ID, and that the bot was switched to OpenID Connect. Codes are short-lived: a code used minutes later (for example after a debugger pause) is refused with `invalid_grant`.

### `?error=unable_to_get_user_info`

**Why:** the plugin refused the ID token. The server log says which check failed:

- **Wrong audience:** `oidc.clientId` isn't the ID of the bot that issued the token.
- **Expired:** tokens live 30 seconds. Check that the server clock is correct (30 seconds of tolerance).
- **Signature:** the server couldn't reach `https://oauth.telegram.org/.well-known/jwks.json` (firewall, proxy, DNS), or the bot signs with ES256K. Use RS256 or ES256.
- **Nonce mismatch:** the token doesn't belong to this sign-in attempt.

### `?error=signup_disabled`

**Why:** `oidc.disableSignUp: true`, and this Telegram user has no account. Working as configured.

### `?error=unable_to_link_account` or `?error=email_does_not_match` after `linkSocial`

**Why:** Better Auth needs `trustedProviders: ["telegram-oidc"]` and `allowDifferentEmails: true` to link a provider without a verified email. See [OIDC: linking](./oidc.md#link-telegram-oidc-to-a-signed-in-user).

### 500 OIDC_CLIENT_SECRET_REQUIRED (or OIDC_CLIENT_ID_REQUIRED)

**Why:** `oidc.clientSecret` (or both `oidc.clientId` and `botToken`) isn't set. Since v3 there is no fallback to the bot token, because Telegram never accepted it.

**Fix:** set `oidc.clientSecret` to the Client Secret from BotFather > your bot > Login Widget.

### 404 or `?error=oauth_provider_not_found`

**Why:** the `telegram-oidc` provider isn't registered: `oidc.enabled` is not `true`.

### BotFather doesn't accept my redirect URI

BotFather rejects `localhost`, with `http` and with `https`. Use a [tunnel](./installation.md#local-development-with-a-tunnel) and register `https://<tunnel host>/api/auth/callback/telegram-oidc`, and set `BETTER_AUTH_URL` to the tunnel address so Better Auth sends the same redirect URI.

### Telegram doesn't send the user back to my site

- **The user declined.** Telegram sends no callback when the user declines; the browser stays on `oauth.telegram.org`. Your app can't detect this, so keep a "Back" link on your own page.
- **The redirect URI doesn't match.** It must be registered in BotFather exactly as Better Auth sends it: `${BETTER_AUTH_URL}/api/auth/callback/telegram-oidc` (adjust for a custom `basePath`).

### OIDC users have no name, username or telegramId

**Why:** the bot signs ID tokens with EdDSA or ES256K, and Telegram then leaves out every profile detail. The plugin logs `the ID token has no profile claims`. Setting `oidc.disableDefaultScope: true` has the same effect.

**Fix:** in BotFather > your bot > Login Widget > Advanced, choose RS256 (the default) or ES256.

### Every OIDC user got a new account

**Why:** you changed the OIDC bot (or `oidc.clientId`). Telegram gives each bot a different `sub` for the same person, and OIDC accounts are stored by `sub`.

**Fix:** go back to the previous bot. Keep one OIDC bot for the life of your app.

### OIDC sign-in doesn't find my existing Login Widget user

Known limitation ([#25](https://github.com/vcode-sh/better-auth-telegram/issues/25)). Better Auth matches OAuth sign-ins by account ID and then by verified email, and a Login Widget user has neither for OIDC. Let signed-in users [link OIDC](./oidc.md#link-telegram-oidc-to-a-signed-in-user) instead. (The other direction works: a Login Widget or Mini App sign-in finds users who signed up with OIDC.)

### OIDC users have no telegramId behind oauth-proxy

Known limitation: with Better Auth's `oauth-proxy` plugin, the token is checked on one server and the user is created on another, so the Telegram ID isn't copied.

### The phone number isn't stored

Check all of these:

1. `oidc.requestPhone: true` is set.
2. The Telegram columns exist: the Login Widget or Mini App must be enabled. In OIDC-only mode there is no `telegramPhoneNumber` column (the plugin warns at startup).
3. The user agreed in Telegram's separate phone dialog.
4. The bot signs with RS256 or ES256 (EdDSA and ES256K get no phone number).

Returning `telegramPhoneNumber` from `mapOIDCProfileToUser` does nothing; the plugin fills it itself.

### ID-token sign-in answers 401 or 404

- **401:** the token is forged, expired (older than about a minute), issued for another Client ID, or sent without the `nonce` it carries. Send `idToken: { token, nonce }`.
- **404 `ID_TOKEN_NOT_SUPPORTED`:** `oidc.disableIdTokenSignIn` is `true`.

### `/account-info` fails for telegram-oidc

Known limitation: Telegram's tokens expire after 30 seconds and can't be refreshed. Read `telegramId`, `telegramUsername` and `telegramPhoneNumber` from the user instead.

### OIDC reports `internal_server_error` with duplicate account identities

Check the server log. If Better Auth reports multiple accounts for one `(providerId, accountId)`, resolve those duplicate rows using the [upgrade checklist](./migration-v2-to-v3.md#3-update-the-database-everyone). Keep different users separate. The plugin does not choose an owner from ambiguous OIDC rows; it rejects sign-in without issuing a session.

## Getting help

If nothing here helps, [open an issue](https://github.com/vcode-sh/better-auth-telegram/issues) with:

- the versions: `npm ls better-auth-telegram better-auth` and `node --version`,
- your framework and database adapter,
- your plugin options (remove tokens and secrets),
- the exact error: response body and the server log lines,
- the steps to reproduce.

For security problems, don't open an issue; see [Security: reporting](./security.md#reporting-a-vulnerability).
