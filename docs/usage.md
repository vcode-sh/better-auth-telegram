# Usage

You've installed a Telegram auth plugin. Congratulations. Now make it do something.

## Client Setup

If you haven't set up the client yet, go read [Installation](./installation.md). We'll wait.

```ts
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

const authClient = createAuthClient({
  baseURL: "http://localhost:3000",
  plugins: [telegramClient()],
});
```

## Sign In (Callback Mode)

The widget pops up, user clicks it, Telegram calls you back. The classic.

`initTelegramWidget` fetches the bot config from your server automatically -- you don't need to pass your bot username. One less thing to leak.

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function TelegramLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authClient.initTelegramWidget(
      "telegram-login", // container element ID
      { size: "large", cornerRadius: 20 },
      async (authData) => {
        const result = await authClient.signInWithTelegram(authData);
        if (result.error) {
          setError(result.error.message);
        } else {
          router.push("/dashboard");
        }
      }
    );
  }, [router]);

  return (
    <div>
      <div id="telegram-login" />
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
```

### Widget Options

All optional. All have sane defaults. Customize if you must.

```ts
authClient.initTelegramWidget("container-id", {
  size: "large",           // "large" | "medium" | "small" (default: "large")
  showUserPhoto: true,     // default: true
  cornerRadius: 20,        // default: 20
  requestAccess: false,    // request write access (default: false)
  lang: "en",              // language code
}, callback);
```

## Sign In (Redirect Mode)

Prefer redirects? Telegram sends the user to your URL with auth data as query params. Old school. Reliable.

### Step 1: Render the Widget

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect } from "react";

export function TelegramLoginRedirect() {
  useEffect(() => {
    authClient.initTelegramWidgetRedirect(
      "telegram-login",
      "/auth/telegram/callback",
      { size: "large" }
    );
  }, []);

  return <div id="telegram-login" />;
}
```

### Step 2: Handle the Callback

Create a page at your redirect URL. Parse the query params, call `signInWithTelegram`.

```tsx
// app/auth/telegram/callback/page.tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function TelegramCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const authData = {
      id: Number(searchParams.get("id")),
      first_name: searchParams.get("first_name")!,
      last_name: searchParams.get("last_name") || undefined,
      username: searchParams.get("username") || undefined,
      photo_url: searchParams.get("photo_url") || undefined,
      auth_date: Number(searchParams.get("auth_date")),
      hash: searchParams.get("hash")!,
    };

    authClient.signInWithTelegram(authData).then((result) => {
      if (result.error) {
        setError(result.error.message);
      } else {
        router.push("/dashboard");
      }
    });
  }, [searchParams, router]);

  if (error) return <p>Auth failed: {error}</p>;
  return <p>Authenticating...</p>;
}
```

## Link Telegram Account

User already signed in? Let them bolt on Telegram. Same widget, different endpoint.

Requires `allowUserToLink: true` on the server (it's the default, relax).

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";

export function LinkTelegram() {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    authClient.initTelegramWidget(
      "telegram-link",
      { size: "medium" },
      async (authData) => {
        const result = await authClient.linkTelegram(authData);
        setStatus(result.error ? result.error.message : "Linked.");
      }
    );
  }, []);

  return (
    <div>
      <div id="telegram-link" />
      {status && <p>{status}</p>}
    </div>
  );
}
```

## Unlink Telegram Account

The digital breakup. No widget needed -- just call `unlinkTelegram`.

```tsx
const result = await authClient.unlinkTelegram();

if (result.error?.code === "CANNOT_UNLINK_LAST_ACCOUNT") {
  console.error("Add another way to sign in first.");
} else if (result.error?.code === "SESSION_NOT_FRESH") {
  console.error("Sign in again, then unlink.");
} else if (result.error) {
  console.error("Unlink failed:", result.error.message);
} else {
  console.log("Telegram unlinked. Freedom.");
}
```

Unlink needs a fresh session, like Better Auth's own `/unlink-account`: a session older than `session.freshAge` (default 1 day) gets 403 `SESSION_NOT_FRESH`. If Telegram is the user's only account, unlink answers 400 `CANNOT_UNLINK_LAST_ACCOUNT` instead of stranding them. Set Better Auth's `account.accountLinking.allowUnlinkingAll: true` if you really want to allow it.

Unlinking actually revokes the Telegram identity. After any `telegram` or `telegram-oidc` account is removed (here, via Better Auth's `POST /unlink-account`, or anything else), the plugin re-checks the user: `telegramId` stays only if a remaining Telegram account proves it, switches to one that does, or is cleared along with `telegramUsername` and `telegramPhoneNumber`. So the unlinked Telegram user can't sign back in through the Login Widget or Mini App.

Linking checks both directions: 409 `TELEGRAM_ALREADY_LINKED_OTHER` if another user has the Telegram account, or already has that `telegramId` on their profile (for example from OIDC). And it's one Telegram user per account: linking a different Telegram id than the user already has is 409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`. `user.validateUserInfo` gets a say first, with action `"link-account"`.

## OIDC (OpenID Connect)

Standard OAuth 2.0 flow via `oauth.telegram.org`. No widgets, no callbacks, no injecting scripts into your DOM. The user clicks a button, gets redirected to Telegram, comes back authenticated. Like every other social login, except it's Telegram, so the setup happens inside a bot. See [Telegram's "Log In With Telegram" docs](https://core.telegram.org/bots/telegram-login) and the [OIDC prerequisites](../README.md#prerequisites).

Enable on server:

```typescript
telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
    requestPhone: true,  // phone numbers -- the Login Widget's biggest regret
  },
});
```

Trigger from client:

```typescript
await authClient.signInWithTelegramOIDC({
  callbackURL: "/dashboard",
});
```

That's it. Better Auth's social login system handles PKCE, state and the callback; the plugin adds the nonce, HTTP Basic client authentication and ID token verification against Telegram's JWKS. You don't need to think about any of it. The `telegram-oidc` provider is injected automatically via the `init` hook — no manual provider registration.

Already holding an ID token client-side? Better Auth's ID token sign-in (`POST /sign-in/social` with an `idToken`) works too:

```typescript
await authClient.$fetch("/sign-in/social", {
  method: "POST",
  body: { provider: "telegram-oidc", idToken: { token, nonce } },
});
```

It's verified against the same JWKS. The `nonce` isn't optional here, even though Better Auth treats it as optional: the plugin only accepts a token together with the nonce it was issued for, and forged, nonce-less or mismatched tokens get a 401. Telegram ID tokens live 30 seconds, so send it right away. Set `oidc.disableIdTokenSignIn: true` to reject ID tokens on `/sign-in/social` and `/link-social` altogether, and `oidc.disableSignUp: true` if OIDC should only sign in existing users.

### OIDC + Phone Numbers

The `phone` scope gives you what the Login Widget never could. With `requestPhone: true`, Telegram can return `phone_number` (digits only, no leading `+`) and `phone_number_verified` (a boolean).

When the Login Widget or Mini App is enabled, the Telegram columns exist and the plugin copies the claims onto the user for you:

```typescript
// The user after an OIDC sign-in with requestPhone: true
{
  name: "John Doe",
  telegramId: "8306595751",          // the `id` claim, not `sub`
  telegramUsername: "johndoe",       // `preferred_username`
  telegramPhoneNumber: "1234567890", // `phone_number`
}
```

Don't try to do this in `mapOIDCProfileToUser`: those fields are `input: false`, and Better Auth silently drops them from mapper output. The old examples here that did exactly that never worked. In an OIDC-only setup there are no Telegram columns, so nothing is copied.

A Login Widget or Mini App sign-in then finds the user who signed up with OIDC, through `telegramId`. The claims only ever go to the user who owns the `telegram-oidc` account for that token's `sub`.

Known limitations:

- The reverse isn't automatic yet (issue #25): Better Auth matches OAuth accounts by provider account id and then by verified email only, so an OIDC sign-in won't find an existing widget/Mini App user.
- With Better Auth's `oauth-proxy` plugin, the Telegram id isn't copied onto the user: the claims are verified on the server that exchanges the code, and the user is created on the other one.
- Better Auth's `/account-info` stops working for `telegram-oidc` after about 30 seconds. Telegram issues 30-second tokens and no refresh token.

### React Example

```tsx
"use client";

import { authClient } from "@/lib/auth-client";

export function TelegramOIDCLogin() {
  return (
    <button
      onClick={() =>
        authClient.signInWithTelegramOIDC({
          callbackURL: "/dashboard",
        })
      }
    >
      Sign in with Telegram
    </button>
  );
}
```

No widget scripts, no container elements, no cleanup on unmount. A button. That's it.

## Mini App

Running inside a Telegram Mini App? There's a whole separate flow for that. See [Mini Apps](./miniapps.md).

The short version:

```ts
// Auto-signin -- grabs initData from Telegram.WebApp automatically
const result = await authClient.autoSignInFromMiniApp();

// Manual -- pass initData yourself
const result = await authClient.signInWithMiniApp(
  window.Telegram.WebApp.initData
);

// Just validate, don't sign in
const result = await authClient.validateMiniApp(
  window.Telegram.WebApp.initData
);
```

## Fetch Options

Every method (except `initTelegramWidget` and `initTelegramWidgetRedirect`) accepts an optional second parameter for custom fetch options. Headers, credentials, cache control -- whatever you need.

```ts
const result = await authClient.signInWithTelegram(authData, {
  headers: { "x-custom-header": "value" },
});

await authClient.unlinkTelegram({
  credentials: "include",
});
```

## Error Handling

Every method returns `{ data, error }`. If `error` exists, something went wrong. The `error.message` tells you what. The `error.status` tells you how bad.

```ts
const result = await authClient.signInWithTelegram(authData);

if (result.error) {
  // 400 = bad data, 401 = auth failed, 409 = conflict,
  // 500 = server misconfigured (missing bot token, schema not migrated)
  console.error(result.error.status, result.error.message);
  return;
}

// result.data has your session
```

No try/catch needed for normal flows -- errors come back in the result object, not thrown at your face. Network failures are the exception (pun intended).

## Vanilla JS

No React? No problem. Same API, fewer hooks cluttering your life.

```html
<div id="telegram-login"></div>

<script type="module">
  import { createAuthClient } from "better-auth/client";
  import { telegramClient } from "better-auth-telegram/client";

  const authClient = createAuthClient({
    baseURL: window.location.origin,
    plugins: [telegramClient()],
  });

  authClient.initTelegramWidget(
    "telegram-login",
    { size: "large" },
    async (authData) => {
      const result = await authClient.signInWithTelegram(authData);
      if (result.error) {
        alert(result.error.message);
      } else {
        window.location.href = "/dashboard";
      }
    }
  );
</script>
```

## Next Steps

- [Configuration](./configuration.md) -- tweak every knob
- [Mini Apps](./miniapps.md) -- Telegram Mini App deep dive
- [API Reference](./api-reference.md) -- every endpoint, documented
- [Security](./security.md) -- how verification works
- [Troubleshooting](./troubleshooting.md) -- when things go sideways
