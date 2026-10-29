# Troubleshooting

Something broke. You're here. Let's fix it and move on with our lives.

## Table of Contents

- [The Cookie Problem (Start Here)](#the-cookie-problem-start-here)
- [Database Errors](#database-errors)
- [Widget Issues](#widget-issues)
- [Authentication Errors](#authentication-errors)
- [Mini App Errors](#mini-app-errors)
- [OIDC Errors](#oidc-errors)
- [Session Problems](#session-problems)
- [Error Code Reference](#error-code-reference)
- [Getting Help](#getting-help)

## The Cookie Problem (Start Here)

Nine times out of ten, you're here because of this one. Welcome to the club.

### "Unauthorized" (401) When Linking Telegram

**What you see:** a 401 with code `UNAUTHORIZED` (Better Auth's session middleware) when calling `linkTelegram()` or `unlinkTelegram()`, even though Telegram clearly let you log in.

**What happened:** Your browser isn't sending session cookies with the request. No cookies, no session, no authentication. It's not personal.

**The fix:**

```typescript
// This is wrong. This is why you're here.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [telegramClient()],
});

// This is right. Add credentials.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [telegramClient()],
});
```

**Why it works like this:**

1. You sign in to your app (cookie gets set)
2. You authenticate with Telegram (works fine, no cookie needed)
3. You call `linkTelegram()` to connect both accounts
4. Without `credentials: "include"`, your browser ghosts the cookie
5. Server sees no session, returns 401 `UNAUTHORIZED`
6. You end up here

**Also double-check your `baseURL`:**

```typescript
// Good: auto-detect the origin
baseURL: typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL

// Bad: wrong port. Your app runs on :3000, not :4000.
baseURL: "http://localhost:4000"
```

## Database Errors

### Every Auth Request Returns 500: "Database schema mismatch ... Missing columns"

Better Auth >= 1.7.3 validates the database schema at startup and rejects every auth request until it matches. With the Login Widget or Mini App enabled, the plugin needs five columns: `user.telegramId`, `user.telegramUsername`, `user.telegramPhoneNumber`, `account.telegramId`, `account.telegramUsername`. They're nullable, not skippable.

```bash
npx auth@latest generate      # Prisma / Drizzle, then run your ORM's migration
npx auth@latest migrate       # Kysely (built-in adapter)
npx auth@latest check schema  # should now be clean
```

Upgrading from v2? Regenerate anyway: v3 adds an index on `user.telegramId`. `advanced.database.validateSchema: false` silences the check, not the problem.

OIDC-only (`loginWidget: false`, no Mini App)? The plugin adds no columns, so the mismatch is somewhere else.

### 500 on Widget / Mini App Sign-in: `email` Violates NOT NULL (v2.x)

**What you see:** on v2.x, the first Login Widget or Mini App sign-in on a SQL database fails with a 500 and a NOT NULL (or unique) constraint error on `user.email`.

**What happened:** v2 created those users without an email. Better Auth's CLI generates `email` as NOT NULL UNIQUE, so it only ever worked on the memory adapter.

**The fix:** upgrade to v3. New users get `<telegramId>@telegram.placeholder.invalid` (`emailVerified: false`) unless your mapper returns an email.

## Widget Issues

### Widget Not Showing

The Telegram login button has vanished into the void. Possible reasons:

**1. You're initializing before the DOM exists**

```typescript
// Wrong: the element doesn't exist yet
const App = () => {
  authClient.initTelegramWidget("container", {}, callback);
  return <div id="container"></div>;
};

// Right: wait for mount
const App = () => {
  useEffect(() => {
    authClient.initTelegramWidget("container", {}, callback);
  }, []);
  return <div id="container"></div>;
};
```

**2. Mismatched container IDs**

```typescript
// You wrote "telegram-widget" in one place and "telegram-login" in the other.
// Computers are annoyingly literal about this.
authClient.initTelegramWidget("telegram-login", {}, callback);
return <div id="telegram-login"></div>;
```

**3. Domain not set in BotFather**

Telegram won't render the widget if your domain isn't registered. Talk to @BotFather:

```
/setdomain
[Select your bot]
yourdomain.com    (no https://, just the domain)
```

**4. Script blocked by CSP or ad blockers**

Check your browser console. If something is blocking `telegram.org`, add a CSP exception:

```html
<meta http-equiv="Content-Security-Policy"
      content="script-src 'self' https://telegram.org;">
```

### "Bot domain invalid"

Your BotFather domain doesn't match the domain you're on. For local dev, you need a tunnel (ngrok or similar) and that tunnel's domain registered with BotFather.

### Widget Stopped Working After Setting Up OIDC

You pressed **Switch to OpenID Connect Login** in BotFather > your bot > Login Widget. Telegram told you: "This action permanently disables the legacy login method." It meant that bot's Login Widget. Create a second bot: keep the Login Widget on one (`botToken` / `botUsername`) and OIDC on the other (`oidc.clientId` + `oidc.clientSecret`). The plugin warns at startup when both flows are enabled without an explicit `oidc.clientId`.

### Widget Renders But Nothing Happens on Click

**Check your callback exists and does something:**

```typescript
// Wrong: undefined callback. The widget has nowhere to send data.
authClient.initTelegramWidget("container", {}, undefined);

// Right: actual callback that handles the auth data
authClient.initTelegramWidget("container", {}, async (data) => {
  const result = await authClient.signInWithTelegram(data);
  console.log("Result:", result);
});
```

Check the network tab for failed requests to `/api/auth/telegram/signin`. The response body usually tells you exactly what went wrong.

### Hot Reload Breaking the Widget

The widget script gets confused after hot reload. Clean up on unmount:

```typescript
useEffect(() => {
  authClient.initTelegramWidget("container", {}, callback);

  return () => {
    const container = document.getElementById("container");
    if (container) container.innerHTML = "";
  };
}, []);
```

## Authentication Errors

### "Invalid Telegram auth data" (400)

The request body is missing required fields. The plugin expects `id` (number), `first_name` (string), `auth_date` (number), and `hash` (string) at minimum. If any of those are missing or the wrong type, you get this.

Make sure you're passing the raw auth data object from Telegram, not a stringified version of it or some subset.

### "Invalid Telegram authentication" (401)

HMAC verification failed. The data didn't pass the cryptographic check. This means one of:

1. **Wrong bot token** -- the token in your server config doesn't match the bot that generated the auth data
2. **Token has whitespace** -- trailing spaces or newlines in your env var will silently break HMAC
3. **Auth data is too old** -- the `auth_date` exceeded `maxAuthAge` (default: 86400 seconds / 24 hours)
4. **Auth data is from the future** -- `auth_date` more than 60 seconds ahead of your server clock (so your clock is behind)
5. **Data was tampered with** -- someone (or something) modified the auth payload between Telegram and your server, including a `hash` that isn't 64 lowercase hex characters or a field containing a line break (rejected outright)

```typescript
// Trim your token. Trust no env var.
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!.trim(),
  botUsername: "your_bot",
})
```

If the issue is expired auth data, bump `maxAuthAge`:

```typescript
telegram({
  maxAuthAge: 86400 * 7, // 7 days, if you're feeling generous
})
```

Or check that your server clock isn't lying to you:

```bash
date    # is this anywhere near reality?
```

### "User not found and auto-create is disabled" (404)

You set `autoCreateUser: false` and a new Telegram user tried to sign in. The plugin won't create accounts on its own in that mode.

Either enable it:

```typescript
telegram({
  autoCreateUser: true,
})
```

Or make sure users exist before they attempt Telegram sign-in.

### "Linking Telegram accounts is disabled" (403)

You set `allowUserToLink: false` (or it defaulted to... wait, no, it defaults to `true`), or Better Auth's `account.accountLinking.enabled` is `false`, which turns off every kind of linking, this one included. Check both configs.

### "A user with this Telegram account exists, but the account is not linked..." (401)

`ACCOUNT_NOT_LINKED`. Someone already has this `telegramId` (typically a user who signed up with OIDC), the Login Widget / Mini App account isn't linked to them yet, and Better Auth's `account.accountLinking` has `enabled: false` or `disableImplicitLinking: true`, so the sign-in won't link itself. That's the same rule Better Auth applies to OAuth sign-ins. Either drop the setting, or let the signed-in user link Telegram explicitly with `/telegram/link` (allowed with `disableImplicitLinking`, not with `enabled: false`).

### "Invalid origin" (403) on Sign-in

`INVALID_ORIGIN`, from Better Auth. `/telegram/signin` and `/telegram/miniapp/signin` refuse browser requests from origins outside `trustedOrigins`, even without cookies (login CSRF protection, the same as `/sign-in/email`). If your login page or Mini App lives on another origin than the auth server (`app.example.com` vs `api.example.com`), add it:

```typescript
betterAuth({
  trustedOrigins: ["https://app.example.com"],
});
```

### "This Telegram account is already linked to another user" (409)

Someone else already claimed this Telegram account -- either through a linked Telegram account, or because their profile already has this `telegramId` (for example, they signed up with OIDC). One Telegram account, one user. The existing link needs to be removed first before it can be linked to a different user.

### "A different Telegram account is already linked to your account" (409)

Code `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`. One Telegram user per account: this user already has a different `telegramId` (from an earlier link, a Mini App sign-in or OIDC). Unlink the old Telegram account first, then link the new one.

### "This Telegram account is already linked to your account" (409)

You're trying to link a Telegram account that's already linked to... you. It's already done. You can stop now.

### "No Telegram account linked" (404)

You called `unlinkTelegram()` but there's no Telegram account linked to your user. Can't unlink what was never linked.

### "Cannot unlink Telegram: it is the only way to sign in to this account" (400)

Code `CANNOT_UNLINK_LAST_ACCOUNT`. Telegram is the user's only account, and removing it would lock them out. Have them add another sign-in method (password, another provider) first. If you really want to allow it, set Better Auth's option:

```typescript
betterAuth({
  account: {
    accountLinking: { allowUnlinkingAll: true },
  },
});
```

### "Session is not fresh" (403) When Unlinking

Code `SESSION_NOT_FRESH`. `/telegram/unlink` uses Better Auth's `freshSessionMiddleware`, like `/unlink-account`: the session has to be younger than `session.freshAge` (default 1 day). Have the user sign in again, then unlink. Raising `freshAge` works too, if you're comfortable with week-old sessions removing sign-in methods.

### Unlinked User Still Signs In With Telegram

Shouldn't happen any more. Removing a `telegram` or `telegram-oidc` account, through `/telegram/unlink`, Better Auth's `POST /unlink-account` or anything else, re-checks the user and clears `telegramId` unless a remaining Telegram account still proves it. If another account still proves it (e.g. a `telegram-oidc` account for the same Telegram user), the `telegramId` lookup keeps working on purpose; unlink that too. OIDC accounts created before v3 carry no `account.telegramId` until their next OIDC sign-in, so they don't keep it alive. If you deleted account rows with raw SQL, no hook ran; clear `user.telegramId` yourself.

### "Telegram account references a user that does not exist" (500)

Code `ORPHANED_ACCOUNT`. There's a `telegram` row in `account` whose `userId` points at a deleted user. Something deleted the user without its accounts. Delete the stale account row.

### "not_invited" (or Whatever Your Code Is) (403)

Your `user.validateUserInfo` said no. Since v3, Login Widget and Mini App flows go through it, with `source.method` `"telegram-login-widget"` or `"telegram-mini-app"` and `source.action` `"create-user"` (sign-up), `"sign-in"` (returning user) or `"link-account"` (linked by `telegramId`, or `/telegram/link`). Before v3 they bypassed it, so a hook that "never fired" for Telegram users now does -- and now also for people who already have an account. If it's `validation_failed`, your validator threw; that fails closed.

### "User creation was rejected" (403)

Code `USER_CREATION_REJECTED`. A database hook (`databaseHooks.user.create.before` returning `false`, yours or the plugin's) vetoed creating the Telegram user. The plugin's own hook only refuses Telegram placeholder emails that don't belong to the flow, e.g. a `mapTelegramDataToUser` that returns someone else's `<id>@telegram.placeholder.invalid`. Check the server log.

### Can't Sign Up With an `@telegram.placeholder.invalid` Email

By design. Only the Telegram flow for that exact Telegram id may create a user with `<id>@telegram.placeholder.invalid` (and only the OIDC flow for that `sub` with `@telegram-oidc.placeholder.invalid`), and no user's email can be changed to one (400 `PLACEHOLDER_EMAIL_RESERVED`, e.g. from `/change-email`). Otherwise anyone could register a Telegram user's placeholder with a password and block or pre-claim their account.

## Mini App Errors

These only apply if you've enabled Mini App support with `miniApp: { enabled: true }`.

### "initData is required and must be a string" (400)

You sent the Mini App sign-in request without `initData`, or it wasn't a string. Make sure you're grabbing it from the right place:

```typescript
const initData = window.Telegram.WebApp.initData;
await authClient.signInWithMiniApp(initData);
```

### "Invalid Mini App initData" (401)

The HMAC verification for Mini App data failed. Same vibes as the Login Widget version -- wrong bot token, expired data, or tampered payload. The Mini App uses a different HMAC scheme (`HMAC-SHA256` with `"WebAppData"` as the key prefix), but the usual suspects apply.

### "Invalid Mini App data structure" (400)

The `initData` parsed but the resulting object doesn't have the expected shape. Needs `auth_date` (number) and `hash` (string) at minimum. If `user` is present, it needs `id` (number) and `first_name` (string).

### "No user data in initData" (400)

The Mini App `initData` was valid but contained no `user` object. This can happen in certain Mini App contexts. The plugin needs user data to create or find an account.

### "User not found and auto-signin is disabled for Mini Apps" (404)

Both `autoCreateUser` and `miniApp.allowAutoSignin` need to be `true` for the plugin to auto-create users from Mini App sign-ins. If either is `false` and no existing account matches, you get this.

## OIDC Errors

These apply if you've enabled OIDC with `oidc: { enabled: true }`.

### "Provider not found" or OIDC Route Returns 404

The `telegram-oidc` provider isn't being injected. Check:

1. `oidc.enabled` is `true` in your server config
2. You're calling `signInWithTelegramOIDC()` from the client, not some hand-rolled fetch
3. Better Auth version is `>=1.7.12 <1.8.0` — the provider uses the 1.7 social provider contract

### OIDC Redirects to Telegram But Callback Fails

The OAuth callback failed. The `error` query parameter on the redirect tells you where:

1. **`error=invalid_code`** — the code exchange failed. Telegram reports token errors as HTTP 200 with `{"error": "..."}`, and the plugin turns them into `invalid_code`; the server log ("Failed to validate authorization code") has Telegram's actual error. `invalid_client` means the credentials are wrong: use the Client ID and Client Secret from BotFather > your bot > Login Widget (after switching it to OpenID Connect), and remember **Revoke** there invalidates the old secret. The bot ID is only a fallback for `client_id`; the bot token is not a valid OIDC client secret, and v3 no longer falls back to it. The plugin already uses HTTP Basic client authentication, as Telegram requires, so there's nothing to change there.
2. **`error=signup_disabled`** — `oidc.disableSignUp` is on and this Telegram user has no account yet. Working as configured.
3. **`error=unable_to_get_user_info`** — the ID token was rejected (the log says why: bad signature, wrong `aud` because `oidc.clientId` doesn't match the bot, expired, or nonce mismatch). Tokens live 30 seconds, so a server clock off by more than the 30 s tolerance breaks this too. It's also what you get if your server can't reach `https://oauth.telegram.org/.well-known/jwks.json` (firewall, DNS, corporate proxy).
4. **Callback URL not configured** — Better Auth needs to know where your callback lives. Check your `BETTER_AUTH_URL` or `baseURL` configuration, and that the Redirect URI in BotFather is exactly `https://<your host>/api/auth/callback/telegram-oidc` (adjust for your `basePath`).

### OIDC Login Throws "clientSecret is required"

`oidc.clientSecret` is mandatory since v3; the bot-token fallback is gone because Telegram never accepted it. The plugin warns at startup and refuses to start an OIDC login until you set it to the Client Secret from BotFather > your bot > Login Widget.

### ID Token Sign-in Returns 401

`POST /sign-in/social` with `idToken` needs the token **and** the `nonce` it was issued for: `idToken: { token, nonce }`. Better Auth treats the nonce as optional; the plugin doesn't. Also check the token isn't older than 30 seconds (Telegram's lifetime) and was issued for your `oidc.clientId`. A 404 instead means `oidc.disableIdTokenSignIn` is on.

### `/account-info` Fails for Telegram OIDC

Known limitation. Telegram issues 30-second tokens and no refresh token, so Better Auth's `/account-info` stops working for `telegram-oidc` after about 30 seconds. Read what you need from the user record instead (`telegramId`, `telegramUsername`, `telegramPhoneNumber` when the Telegram columns exist).

### BotFather Rejects the Redirect URI

BotFather doesn't accept `localhost` redirect URIs, `http` or `https`. For local development, run a public HTTPS tunnel (ngrok or similar) and register `https://<tunnel host>/api/auth/callback/telegram-oidc`. Point `BETTER_AUTH_URL` at the tunnel too, or the redirect URI Better Auth sends won't match.

### OIDC Users Have No Name, Username or `telegramId`

Your bot signs ID tokens with `EdDSA` (or `ES256K`). Telegram's docs say the profile and phone scopes are rejected for those; live, the flow succeeds and the ID token contains only `iss`, `aud`, `sub`, `iat`, `exp`. The plugin logs `the ID token has no profile claims` when that happens. Switch to `RS256` (the default) or `ES256` in BotFather > your bot > Login Widget > Advanced > Signing Algorithm. `ES256K` can't be verified with Web Crypto at all.

### Every OIDC User Got a New Account After Switching Bots

`sub` is scoped per bot: the same Telegram user gets a different `sub` from each bot, and the OIDC account is keyed by `sub`. Switching bots (or client ids) therefore creates new accounts. Stick with one OIDC bot.

### OIDC Users Have No `telegramId` Behind `oauth-proxy`

Known limitation. With Better Auth's `oauth-proxy` plugin, the claims are verified on the server that exchanges the code, but the user is created on the other one, so the Telegram id isn't copied onto the user.

### OIDC Sign-in Doesn't Find My Existing Login Widget User

Known limitation (issue #25, the reverse direction). Better Auth matches OAuth accounts by provider account id and then by verified email only, and a widget user has neither: a different provider, and an unverified placeholder email. The other direction works: once an OIDC user exists (and the Telegram columns exist), a Login Widget or Mini App sign-in finds them via `telegramId`. Until then, let signed-in widget users link OIDC through Better Auth's account linking.

### "Phone number not populated"

You need `requestPhone: true` in your OIDC config **and** the user needs to consent to sharing their phone number during the OAuth flow. If they decline, you get everything except the phone.

```typescript
oidc: {
  enabled: true,
  requestPhone: true,  // this one
}
```

When the Login Widget or Mini App is enabled (so the Telegram columns exist), the plugin copies `phone_number` to `user.telegramPhoneNumber` after the OIDC sign-in. Digits only, no leading `+`. In an OIDC-only setup there's no column to copy into.

Returning `telegramPhoneNumber` from `mapOIDCProfileToUser` does nothing -- the field is `input: false` and Better Auth drops it from mapper output. Older versions of these docs said otherwise; they were wrong. Also check the signing algorithm: `EdDSA` / `ES256K` bots get no phone claim at all (see above).

## Session Problems

### No Session After Successful Login

The sign-in returned a user and session, but subsequent requests act like nobody's home.

**1. Missing `credentials: "include"`** -- yes, that problem again. See [The Cookie Problem](#the-cookie-problem-start-here).

**2. `baseURL` mismatch** -- if your client points to a different origin than where cookies were set, the browser won't send them:

```typescript
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL,
  fetchOptions: { credentials: "include" },
  plugins: [telegramClient()],
});
```

**3. CORS not configured** -- if your frontend and backend are on different origins:

```typescript
export const auth = betterAuth({
  advanced: {
    cors: {
      origin: ["https://your-frontend.com"],
      credentials: true,
    },
  },
});
```

**4. Cookie domain mismatch** -- check DevTools > Application > Cookies. The cookie should be set for your domain with the right flags.

### Cookies Not Being Set in Production

Usually `Secure` flag + HTTP. In production, you need HTTPS. This is a Better Auth configuration concern:

```typescript
advanced: {
  useSecureCookies: process.env.NODE_ENV === "production",
}
```

## Error Code Reference

Every error this plugin can throw, mapped to what actually went wrong:

| Error Message | HTTP Status | What It Means |
|---|---|---|
| `Telegram plugin: botToken is required` | 500 | An enabled Login Widget or Mini App request reached the server without a configured `botToken`. Setup also logs a warning. |
| `Telegram plugin: botUsername is required` | Client error | The client tried to render the Login Widget without a configured username. Setup also logs a warning. |
| `Invalid Telegram auth data` | 400 | Request body missing required fields (`id`, `first_name`, `auth_date`, `hash`). |
| `Invalid Telegram authentication` | 401 | HMAC check failed. Wrong token, expired data, or tampered payload. |
| `User not found and auto-create is disabled` | 404 | `autoCreateUser` is `false` and no existing account matches. |
| `Unauthorized` (`UNAUTHORIZED`, from Better Auth) | 401 | No valid session. Probably missing `credentials: "include"`. |
| `Linking Telegram accounts is disabled` | 403 | `allowUserToLink` is `false`, or Better Auth's `account.accountLinking.enabled` is `false`. |
| `A user with this Telegram account exists, but the account is not linked and account linking does not allow linking it on sign-in` | 401 | `ACCOUNT_NOT_LINKED`: implicit linking by `telegramId` is off (`accountLinking.enabled: false` or `disableImplicitLinking: true`). |
| `Invalid origin` (`INVALID_ORIGIN`, from Better Auth) | 403 | Sign-in from an origin outside `trustedOrigins`. |
| `This Telegram account is already linked to another user` | 409 | Telegram account belongs to a different user. |
| `This Telegram account is already linked to your account` | 409 | Already linked. Nothing to do. |
| `No Telegram account linked` | 404 | Tried to unlink but nothing was linked. |
| `A different Telegram account is already linked to your account` | 409 | One Telegram identity per user; unlink the old one first. |
| `Cannot unlink Telegram: it is the only way to sign in to this account` | 400 | Unlink would strand the user; see `allowUnlinkingAll`. |
| `Session is not fresh` (`SESSION_NOT_FRESH`, from Better Auth) | 403 | Unlink needs a session younger than `session.freshAge`. |
| `User creation was rejected` | 403 | A database hook vetoed creating the Telegram user. |
| `Telegram account references a user that does not exist` | 500 | Orphaned `account` row; delete it. |
| `initData is required and must be a string` | 400 | Mini App request missing `initData` or wrong type. |
| `Invalid Mini App initData` | 401 | Mini App HMAC verification failed. |
| `Invalid Mini App data structure` | 400 | Parsed initData has wrong structure. |
| `No user data in initData` | 400 | initData has no `user` object. |
| `User not found and auto-signin is disabled for Mini Apps` | 404 | `autoCreateUser` or `miniApp.allowAutoSignin` is `false`, no existing account. |

`Not authenticated` (`NOT_AUTHENTICATED`) is still in `$ERROR_CODES` but no endpoint throws it.

## Getting Help

### What to Include When Reporting Issues

```bash
npm list better-auth-telegram better-auth   # plugin and Better Auth versions
node --version                               # Node.js version
```

Plus: your framework, the error message (full text), and steps to reproduce. Sanitize your config (no tokens).

### Where to Go

- **GitHub Issues:** [github.com/vcode-sh/better-auth-telegram/issues](https://github.com/vcode-sh/better-auth-telegram/issues)
- **Better Auth Discord:** [better-auth.com/discord](https://better-auth.com/discord)

### Before You Open an Issue

- [ ] Read through this page (you're already here, so partial credit)
- [ ] Searched existing issues
- [ ] Verified env vars are set and trimmed
- [ ] Tested with the latest version
- [ ] Have a minimal reproduction

## Next Steps

- [Security Best Practices](./security.md)
- [Configuration Guide](./configuration.md)
- [API Reference](./api-reference.md)
- [Usage Examples](./usage.md)
