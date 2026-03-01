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

if (result.error) {
  console.error("Unlink failed:", result.error.message);
} else {
  console.log("Telegram unlinked. Freedom.");
}
```

## OIDC (OpenID Connect)

Standard OAuth 2.0 flow via `oauth.telegram.org`. No widgets, no callbacks, no injecting scripts into your DOM. The user clicks a button, gets redirected to Telegram, comes back authenticated. Like every other social login, except it's Telegram and it took them until Bot API 9.5 to ship it.

Enable on server:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "your_bot_username",
  oidc: {
    enabled: true,
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

That's it. Better Auth's social login system handles the PKCE, state tokens, JWT verification, and callback. You don't need to think about any of it. The `telegram-oidc` provider is injected automatically via the `init` hook — no manual provider registration.

### OIDC + Phone Numbers

The `phone` scope gives you what the Login Widget never could. When `requestPhone: true`, the user's phone number lands in `telegramPhoneNumber` on the user record after OIDC sign-in.

```typescript
// After OIDC sign-in, your user record has:
{
  name: "John Doe",
  telegramId: "123456789",
  telegramUsername: "johndoe",
  telegramPhoneNumber: "+1234567890",  // only via OIDC with phone scope
}
```

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
  // 400 = bad data, 401 = auth failed, 409 = conflict
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
