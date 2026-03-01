# Troubleshooting

Something broke. You're here. Let's fix it and move on with our lives.

## Table of Contents

- [The Cookie Problem (Start Here)](#the-cookie-problem-start-here)
- [Widget Issues](#widget-issues)
- [Authentication Errors](#authentication-errors)
- [Mini App Errors](#mini-app-errors)
- [Session Problems](#session-problems)
- [Error Code Reference](#error-code-reference)
- [Getting Help](#getting-help)

## The Cookie Problem (Start Here)

Nine times out of ten, you're here because of this one. Welcome to the club.

### "Not authenticated" When Linking Telegram

**What you see:** `{ error: "Not authenticated" }` when calling `linkTelegram()`, even though Telegram clearly let you log in.

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
5. Server sees no session, returns "Not authenticated"
6. You end up here

**Also double-check your `baseURL`:**

```typescript
// Good: auto-detect the origin
baseURL: typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL

// Bad: wrong port. Your app runs on :3000, not :4000.
baseURL: "http://localhost:4000"
```

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
4. **Data was tampered with** -- someone (or something) modified the auth payload between Telegram and your server

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

You set `allowUserToLink: false` (or it defaulted to... wait, no, it defaults to `true`). If you're getting this, you explicitly disabled linking. Check your plugin config.

### "This Telegram account is already linked to another user" (409)

Someone else already claimed this Telegram account. One Telegram account, one user. The existing link needs to be removed first before it can be linked to a different user.

### "This Telegram account is already linked to your account" (409)

You're trying to link a Telegram account that's already linked to... you. It's already done. You can stop now.

### "No Telegram account linked" (404)

You called `unlinkTelegram()` but there's no Telegram account linked to your user. Can't unlink what was never linked.

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
3. Better Auth version is `^1.5.0` — older versions may not support the `init` hook correctly

### OIDC Redirects to Telegram But Callback Fails

The OAuth callback failed. Usual suspects:

1. **Bot token mismatch** — the bot ID (first part of the token, before the `:`) is used as the `client_id`. If the token is wrong, Telegram rejects the token exchange.
2. **Callback URL not configured** — Better Auth needs to know where your callback lives. Check your `BETTER_AUTH_URL` or `baseURL` configuration.
3. **JWKS fetch failed** — the plugin fetches public keys from `oauth.telegram.org/.well-known/jwks.json`. If your server can't reach that URL (firewall, DNS, corporate proxy), JWT verification fails silently.

### "Phone number not populated"

You need `requestPhone: true` in your OIDC config **and** the user needs to consent to sharing their phone number during the OAuth flow. If they decline, you get everything except the phone.

```typescript
oidc: {
  enabled: true,
  requestPhone: true,  // this one
}
```

Also make sure your `user` table has the `telegramPhoneNumber` column. The plugin won't yell at you if it's missing — it'll just silently not store it.

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
| `Telegram plugin: botToken is required` | N/A (thrown at init) | You didn't pass `botToken` to the plugin config. It won't even start. |
| `Telegram plugin: botUsername is required` | N/A (thrown at init) | You didn't pass `botUsername` to the plugin config. Also won't start. |
| `Invalid Telegram auth data` | 400 | Request body missing required fields (`id`, `first_name`, `auth_date`, `hash`). |
| `Invalid Telegram authentication` | 401 | HMAC check failed. Wrong token, expired data, or tampered payload. |
| `User not found and auto-create is disabled` | 404 | `autoCreateUser` is `false` and no existing account matches. |
| `Not authenticated` | 401 | No valid session. Probably missing `credentials: "include"`. |
| `Linking Telegram accounts is disabled` | 403 | `allowUserToLink` is `false`. |
| `This Telegram account is already linked to another user` | 409 | Telegram account belongs to a different user. |
| `This Telegram account is already linked to your account` | 409 | Already linked. Nothing to do. |
| `No Telegram account linked` | 404 | Tried to unlink but nothing was linked. |
| `initData is required and must be a string` | 400 | Mini App request missing `initData` or wrong type. |
| `Invalid Mini App initData` | 401 | Mini App HMAC verification failed. |
| `Invalid Mini App data structure` | 400 | Parsed initData has wrong structure. |
| `No user data in initData` | 400 | initData has no `user` object. |
| `User not found and auto-signin is disabled for Mini Apps` | 404 | `autoCreateUser` or `miniApp.allowAutoSignin` is `false`, no existing account. |

## Getting Help

### What to Include When Reporting Issues

```bash
npm list better-auth-telegram    # plugin version
node --version                   # Node.js version
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
