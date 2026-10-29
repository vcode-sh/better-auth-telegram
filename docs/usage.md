# Usage: Login Widget, linking and errors

This page covers the browser side of the plugin: showing the Telegram Login Widget, linking and unlinking Telegram for signed-in users, reading Telegram details from the session, and handling errors. It assumes you finished [Installation](./installation.md) and have an `authClient` like this:

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  plugins: [telegramClient()],
});
```

For OIDC see [OIDC](./oidc.md); for Mini Apps see [Mini Apps](./miniapps.md).

## Contents

- [How Login Widget sign-in works](#how-login-widget-sign-in-works)
- [Show the widget (callback mode)](#show-the-widget-callback-mode)
- [React component](#react-component)
- [Redirect mode](#redirect-mode)
- [Widget options](#widget-options)
- [After sign-in: the session](#after-sign-in-the-session)
- [Link Telegram to a signed-in user](#link-telegram-to-a-signed-in-user)
- [Unlink Telegram](#unlink-telegram)
- [Handle errors](#handle-errors)
- [Fetch options](#fetch-options)

## How Login Widget sign-in works

1. Your page shows Telegram's button. The plugin loads Telegram's script and asks your server for the bot username (`GET /api/auth/telegram/config`).
2. The user clicks it and confirms in Telegram.
3. Telegram gives your page the user's details (ID, name, username, photo), signed with a key derived from your bot token.
4. You send those details to your server with `signInWithTelegram()`. The plugin checks the signature and the age of the data, finds or creates the user, and starts a session.

The browser never sees your bot token. It only forwards what Telegram signed.

## Show the widget (callback mode)

In callback mode, Telegram hands the data to a function on your page. This is the most common setup.

```ts
// login.ts
import { authClient } from "./auth-client";

export async function showTelegramLogin() {
  const widget = await authClient.initTelegramWidget(
    "telegram-login", // the id of an empty element on your page, or the element itself
    { size: "large" },
    async (telegramData) => {
      const { error } = await authClient.signInWithTelegram(telegramData);
      if (error) {
        console.error("Telegram sign-in failed:", error.message);
        return;
      }
      window.location.href = "/dashboard";
    }
  );
  return widget; // widget.destroy() removes the button again
}
```

What `initTelegramWidget` does: it loads Telegram's widget script (`https://telegram.org/js/telegram-widget.js?24`), fetches your bot username from the server, **replaces the contents** of the container with the button, and returns a handle with `destroy()`. It throws if the container doesn't exist, the script can't load, or the server has no `botUsername`.

## React component

In React, create the widget in an effect and remove it in the cleanup. Each effect owns its own inner element, so a slow, cancelled initialization cannot remove the next button when React runs effects twice in development.

```tsx
// TelegramLoginButton.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { authClient } from "./auth-client";

export function TelegramLoginButton() {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current) {
      return;
    }
    const host = document.createElement("div");
    container.current.appendChild(host);
    const widget = authClient.initTelegramWidget(
      host,
      { size: "large" },
      async (telegramData) => {
        const result = await authClient.signInWithTelegram(telegramData);
        if (result.error) {
          setError(result.error.message ?? "Sign-in failed");
          return;
        }
        window.location.href = "/dashboard";
      }
    );
    widget.catch(() => {
      if (host.isConnected) setError("Could not load the Telegram button");
    });
    return () => {
      host.remove();
      widget.then((w) => w.destroy()).catch(() => undefined);
    };
  }, []);

  return (
    <div>
      <div ref={container} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

With client-side navigation (for example Next.js `router.push("/dashboard")`) instead of `window.location.href`, the page still shows the signed-in user: see [After sign-in: the session](#after-sign-in-the-session).

## Redirect mode

In redirect mode, Telegram sends the browser to a URL of yours, with the user's details in the query string. Use it if you prefer a full page load to a JavaScript callback.

**Step 1: show the widget with a redirect URL.**

```ts
// login-redirect.ts
import { authClient } from "./auth-client";

export async function showTelegramLoginRedirect() {
  return await authClient.initTelegramWidgetRedirect(
    "telegram-login",
    `${window.location.origin}/auth/telegram/callback`,
    { size: "large" }
  );
}
```

**Step 2: on the callback page, read the query string and sign in.**

```ts
// telegram-callback.ts (runs on /auth/telegram/callback)
import type { TelegramAuthData } from "better-auth-telegram";
import { authClient } from "./auth-client";

function readTelegramRedirect(search: string): TelegramAuthData | null {
  const params = new URLSearchParams(search);
  const id = params.get("id");
  const firstName = params.get("first_name");
  const authDate = params.get("auth_date");
  const hash = params.get("hash");
  if (!(id && firstName && authDate && hash)) {
    return null;
  }
  return {
    id: Number(id),
    first_name: firstName,
    auth_date: Number(authDate),
    hash,
    last_name: params.get("last_name") ?? undefined,
    username: params.get("username") ?? undefined,
    photo_url: params.get("photo_url") ?? undefined,
  };
}

export async function finishTelegramRedirect() {
  const telegramData = readTelegramRedirect(window.location.search);
  if (!telegramData) {
    return "Telegram did not send any sign-in data.";
  }
  const { error } = await authClient.signInWithTelegram(telegramData);
  if (error) {
    return error.message ?? "Sign-in failed";
  }
  window.location.href = "/dashboard";
  return null;
}
```

Two details matter here:

- `id` and `auth_date` must be **numbers**. Query strings are always text, and the server answers 400 `INVALID_AUTH_DATA` if they arrive as strings.
- Send **only the fields Telegram sent**, unchanged. The signature covers exactly those fields, so adding an empty `last_name` or changing a value makes the check fail (401).

## Widget options

The second argument of `initTelegramWidget` and the third of `initTelegramWidgetRedirect`. All are optional.

| Option | Type | Default | What it does |
|---|---|---|---|
| `size` | `"large" \| "medium" \| "small"` | `"large"` | Button size. |
| `showUserPhoto` | `boolean` | `true` | Show the user's Telegram photo on the button. |
| `cornerRadius` | `number` | `20` | Corner radius of the button, in pixels. |
| `requestAccess` | `boolean` | `false` | Also ask the user to let your bot send them messages. |
| `lang` | `string` | not set | Button language, for example `"en"` or `"pl"`. Leave it out to use Telegram's default. |

## After sign-in: the session

After a successful `signInWithTelegram`, Better Auth has set the session cookie, and the client tells `useSession()` (and any other session listener) to reload. Your UI updates without a page reload. The same happens after `signInWithMiniApp`, `autoSignInFromMiniApp`, `linkTelegram` and `unlinkTelegram`. To skip that refresh for one call, pass `{ disableSignal: true }` as fetch options.

The result also contains the user and session directly:

```ts
import type { TelegramAuthData } from "better-auth-telegram";
import { authClient } from "./auth-client";

export async function signIn(telegramData: TelegramAuthData) {
  const { data, error } = await authClient.signInWithTelegram(telegramData);
  if (error) {
    return null;
  }
  // data.user.telegramId: string | null | undefined
  return data.user;
}
```

The Telegram fields are part of the user type everywhere, so TypeScript knows them on the server too:

```ts
// anywhere on the server
import { auth } from "./auth";

export async function currentTelegramId(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  return session?.user.telegramId ?? null;
}
```

## Link Telegram to a signed-in user

A user who signed up another way (email, Google...) can add Telegram as a second sign-in method. Use the same widget, but call `linkTelegram` instead of `signInWithTelegram`:

```ts
// link-telegram.ts
import { authClient } from "./auth-client";

export async function showLinkTelegramButton() {
  return await authClient.initTelegramWidget(
    "telegram-link",
    { size: "medium" },
    async (telegramData) => {
      const { error } = await authClient.linkTelegram(telegramData);
      if (error) {
        console.error("Could not link Telegram:", error.message);
        return;
      }
      console.log("Telegram is now linked to your account.");
    }
  );
}
```

The user must be signed in. Linking is refused when:

| Status and code | Why |
|---|---|
| 401 `UNAUTHORIZED` | Nobody is signed in in this browser (no session cookie reached the server). |
| 403 `LINKING_DISABLED` | You set `allowUserToLink: false`, or Better Auth's `account.accountLinking.enabled: false`. |
| 409 `TELEGRAM_ALREADY_LINKED_OTHER` | This Telegram account already belongs to another user. |
| 409 `TELEGRAM_ALREADY_LINKED_SELF` | It's already linked to this user. Nothing to do. |
| 409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED` | This user already has a *different* Telegram account. A user can have one Telegram identity; unlink the old one first. |

On success, `user.telegramId` and `user.telegramUsername` are set, and the session cookie is renewed so the session shows them immediately. Your `user.validateUserInfo` hook (if you have one) is asked first, with action `"link-account"`.

## Unlink Telegram

```ts
// unlink-telegram.ts
import { authClient } from "./auth-client";

export async function unlinkTelegram() {
  const { error } = await authClient.unlinkTelegram();
  if (error?.code === "CANNOT_UNLINK_LAST_ACCOUNT") {
    return "Add another way to sign in (for example a password) before removing Telegram.";
  }
  if (error?.code === "SESSION_NOT_FRESH") {
    return "For your security, please sign in again, then try once more.";
  }
  if (error) {
    return error.message ?? "Could not unlink Telegram.";
  }
  return "Telegram has been removed from your account.";
}
```

Two rules protect your users here. They match Better Auth's own `/unlink-account`:

- **A recent sign-in is required.** If the session is older than Better Auth's `session.freshAge` (1 day by default), unlink answers 403 `SESSION_NOT_FRESH`. This stops someone with an old, stolen session from removing the owner's sign-in method.
- **The last sign-in method stays.** If Telegram is the only way into the account, unlink answers 400 `CANNOT_UNLINK_LAST_ACCOUNT`, so nobody gets locked out. Better Auth's `account.accountLinking.allowUnlinkingAll: true` turns this rule off.

After unlinking, the user can no longer sign in with that Telegram account through the Login Widget or a Mini App: the plugin clears `user.telegramId`, `telegramUsername` and `telegramPhoneNumber`. If another Telegram account of the user (for example an OIDC account for the same person) still proves a Telegram ID, the user keeps that one instead. The same check runs when a Telegram account is removed by Better Auth's `/unlink-account` or any other route.

## Handle errors

Every client action returns `{ data, error }` instead of throwing. When something goes wrong, `data` is `null` and `error` has:

- `status`: the HTTP status, for example `401`.
- `code`: a stable code such as `INVALID_AUTHENTICATION`. Compare against this.
- `message`: a readable English message, good for logs.

The plugin's codes are exported as `TELEGRAM_ERROR_CODES` from `better-auth-telegram/client` (no server code included), so you don't have to type strings by hand:

```ts
import { TELEGRAM_ERROR_CODES } from "better-auth-telegram/client";
import { authClient } from "./auth-client";

export async function unlinkWithCodes() {
  const { error } = await authClient.unlinkTelegram();
  if (error?.code === TELEGRAM_ERROR_CODES.CANNOT_UNLINK_LAST_ACCOUNT.code) {
    // ask the user to add another sign-in method first
  }
}
```

Some codes come from Better Auth itself, for example `SESSION_NOT_FRESH`, `INVALID_ORIGIN` or `UNAUTHORIZED`. Every code, with its status and meaning, is in the [API reference](./api-reference.md#error-codes); fixes are in [Troubleshooting](./troubleshooting.md).

Two kinds of problems are thrown instead of returned, so wrap those calls in `try`/`catch` if you want to handle them:

- Network failures, when the request never reaches your server (offline, DNS, server down). This is how Better Auth's client works for every action.
- Problems on the page itself: `initTelegramWidget` and `initTelegramWidgetRedirect` throw when the container is missing, Telegram's script can't load or the server has no `botUsername`; `autoSignInFromMiniApp` throws when the page isn't running inside Telegram.

## Fetch options

Every action that talks to the server takes an optional last argument with fetch options, for example extra headers:

```ts
import type { TelegramAuthData } from "better-auth-telegram";
import { authClient } from "./auth-client";

export async function signInWithHeader(telegramData: TelegramAuthData) {
  return await authClient.signInWithTelegram(telegramData, {
    headers: { "x-request-source": "landing-page" },
  });
}
```

`initTelegramWidget` and `initTelegramWidgetRedirect` don't take fetch options.

## Next steps

- [Configuration](./configuration.md): change defaults, map Telegram data to your user fields.
- [Security](./security.md): what the plugin checks, and its known limits.
- [Troubleshooting](./troubleshooting.md): fixes by symptom.
