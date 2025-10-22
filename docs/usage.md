# Usage Guide

This guide covers common usage patterns and examples for the better-auth-telegram plugin.

## Table of Contents

- [Basic Sign In](#basic-sign-in)
- [Sign In with Redirect](#sign-in-with-redirect)
- [Link Telegram Account](#link-telegram-account)
- [Unlink Telegram Account](#unlink-telegram-account)
- [Session Management](#session-management)
- [Framework-Specific Examples](#framework-specific-examples)

## Basic Sign In

The most common use case is signing in with the Telegram widget using a callback function.

### React/Next.js Example

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function TelegramLoginButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Initialize the Telegram widget
    authClient.initTelegramWidget(
      "telegram-login-container",
      {
        size: "large",
        showUserPhoto: true,
        cornerRadius: 20,
        lang: "en",
      },
      async (authData) => {
        setLoading(true);
        setError(null);

        try {
          const result = await authClient.signInWithTelegram(authData);

          if (result.error) {
            setError(result.error.message);
            setLoading(false);
          } else {
            // Successfully signed in
            router.push("/dashboard");
          }
        } catch (err) {
          setError("An unexpected error occurred");
          setLoading(false);
        }
      }
    );
  }, [router]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div id="telegram-login-container"></div>
      {loading && <p className="text-gray-600">Signing in...</p>}
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
```

### Key Points

- The widget is initialized in `useEffect` to ensure the DOM element exists
- The `containerId` must match an actual element ID in your JSX
- The callback receives `authData` which is then passed to `signInWithTelegram`
- Handle both success and error cases

## Sign In with Redirect

Instead of using a callback, you can redirect users to a specific page after authentication.

### Step 1: Initialize Widget with Redirect

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect } from "react";

export function TelegramLoginRedirect() {
  useEffect(() => {
    authClient.initTelegramWidgetRedirect(
      "telegram-login-container",
      "/auth/telegram/callback", // Your callback page
      {
        size: "medium",
        showUserPhoto: true,
        cornerRadius: 10,
      }
    );
  }, []);

  return (
    <div>
      <h2>Sign in with Telegram</h2>
      <div id="telegram-login-container"></div>
    </div>
  );
}
```

### Step 2: Create Callback Page

Create a page to handle the redirect:

```tsx
// app/auth/telegram/callback/page.tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function TelegramCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      // Extract auth data from URL parameters
      const authData = {
        id: Number(searchParams.get("id")),
        first_name: searchParams.get("first_name")!,
        last_name: searchParams.get("last_name") || undefined,
        username: searchParams.get("username") || undefined,
        photo_url: searchParams.get("photo_url") || undefined,
        auth_date: Number(searchParams.get("auth_date")),
        hash: searchParams.get("hash")!,
      };

      // Validate that we have all required fields
      if (!authData.id || !authData.first_name || !authData.auth_date || !authData.hash) {
        setError("Invalid authentication data");
        return;
      }

      try {
        const result = await authClient.signInWithTelegram(authData);

        if (result.error) {
          setError(result.error.message);
        } else {
          router.push("/dashboard");
        }
      } catch (err) {
        setError("Authentication failed");
      }
    };

    handleCallback();
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-2xl font-bold text-red-600">Authentication Error</h1>
        <p className="mt-4">{error}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Processing...</h1>
        <p className="mt-4">Completing your authentication</p>
      </div>
    </div>
  );
}
```

## Link Telegram Account

Allow users to link their Telegram account to an existing authenticated account.

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";

export function LinkTelegramButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    authClient.initTelegramWidget(
      "telegram-link-container",
      {
        size: "small",
        showUserPhoto: false,
        cornerRadius: 5,
      },
      async (authData) => {
        setStatus("loading");
        setMessage("Linking your Telegram account...");

        try {
          await authClient.linkTelegram(authData);
          setStatus("success");
          setMessage("Telegram account linked successfully!");
        } catch (error: any) {
          setStatus("error");
          setMessage(error?.message || "Failed to link Telegram account");
        }
      }
    );
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold">Link Telegram Account</h3>
      <p className="text-sm text-gray-600">
        Connect your Telegram account for faster sign-in
      </p>

      <div id="telegram-link-container"></div>

      {status !== "idle" && (
        <div
          className={`p-4 rounded ${
            status === "success"
              ? "bg-green-100 text-green-800"
              : status === "error"
              ? "bg-red-100 text-red-800"
              : "bg-blue-100 text-blue-800"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
```

### Requirements

- User must be authenticated before linking
- The plugin must be configured with `allowUserToLink: true` (default)
- Each Telegram account can only be linked to one user

## Unlink Telegram Account

Allow users to remove their Telegram account connection.

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";

export function UnlinkTelegramButton({ telegramUsername }: { telegramUsername?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlink = async () => {
    if (!confirm("Are you sure you want to unlink your Telegram account?")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await authClient.unlinkTelegram();
      // Refresh the page or update UI
      window.location.reload();
    } catch (err: any) {
      setError(err?.message || "Failed to unlink Telegram account");
      setLoading(false);
    }
  };

  if (!telegramUsername) {
    return null; // No Telegram account linked
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-gray-600">
        Linked account: <strong>@{telegramUsername}</strong>
      </p>
      <button
        onClick={handleUnlink}
        disabled={loading}
        className="px-4 py-2 bg-red-500 text-white rounded disabled:opacity-50"
      >
        {loading ? "Unlinking..." : "Unlink Telegram"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

## Session Management

### Get Current Session

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";

export function SessionDisplay() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const result = await authClient.getSession();
        if (result.data) {
          setSession(result.data);
        }
      } catch (error) {
        console.error("Failed to get session:", error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!session) {
    return <div>No active session</div>;
  }

  return (
    <div className="p-4 border rounded">
      <h3 className="font-bold">Session Information</h3>
      <p>Name: {session.user.name}</p>
      <p>Email: {session.user.email || "N/A"}</p>
      {session.user.telegramUsername && (
        <p>Telegram: @{session.user.telegramUsername}</p>
      )}
    </div>
  );
}
```

### Sign Out

```tsx
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/");
  };

  return (
    <button onClick={handleSignOut} className="px-4 py-2 bg-gray-500 text-white rounded">
      Sign Out
    </button>
  );
}
```

## Framework-Specific Examples

### Next.js App Router (Full Example)

```tsx
// app/page.tsx
import { TelegramLoginButton } from "@/components/TelegramLoginButton";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Welcome</h1>
      <TelegramLoginButton />
    </main>
  );
}

// components/TelegramLoginButton.tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function TelegramLoginButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authClient.initTelegramWidget(
      "telegram-login-container",
      { size: "large", showUserPhoto: true, cornerRadius: 20 },
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
      <div id="telegram-login-container"></div>
      {error && <p className="text-red-500 mt-2">{error}</p>}
    </div>
  );
}
```

### Vanilla JavaScript

```html
<!DOCTYPE html>
<html>
<head>
  <title>Telegram Login</title>
</head>
<body>
  <h1>Sign in with Telegram</h1>
  <div id="telegram-login"></div>
  <div id="status"></div>

  <script type="module">
    import { createAuthClient } from "better-auth/client";
    import { telegramClient } from "better-auth-telegram/client";

    const authClient = createAuthClient({
      baseURL: window.location.origin,
      fetchOptions: {
        credentials: "include",
      },
      plugins: [telegramClient()],
    });

    authClient.initTelegramWidget(
      "telegram-login",
      { size: "large" },
      async (authData) => {
        document.getElementById("status").textContent = "Signing in...";

        const result = await authClient.signInWithTelegram(authData);

        if (result.error) {
          document.getElementById("status").textContent = "Error: " + result.error.message;
        } else {
          document.getElementById("status").textContent = "Signed in! Redirecting...";
          setTimeout(() => {
            window.location.href = "/dashboard";
          }, 1000);
        }
      }
    );
  </script>
</body>
</html>
```

### React SPA (Vite)

```tsx
// src/App.tsx
import { useEffect, useState } from "react";
import { authClient } from "./lib/auth-client";

function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const session = await authClient.getSession();
    if (session.data) {
      setUser(session.data.user);
    }
    setLoading(false);
  };

  if (loading) return <div>Loading...</div>;

  if (user) {
    return (
      <div>
        <h1>Welcome, {user.name}!</h1>
        <button onClick={() => {
          authClient.signOut();
          setUser(null);
        }}>
          Sign Out
        </button>
      </div>
    );
  }

  return <TelegramLogin onSuccess={checkAuth} />;
}

function TelegramLogin({ onSuccess }: { onSuccess: () => void }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authClient.initTelegramWidget(
      "telegram-login",
      { size: "large" },
      async (authData) => {
        const result = await authClient.signInWithTelegram(authData);
        if (result.error) {
          setError(result.error.message);
        } else {
          onSuccess();
        }
      }
    );
  }, [onSuccess]);

  return (
    <div>
      <h1>Sign In</h1>
      <div id="telegram-login"></div>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

export default App;
```

## Widget Customization

### Different Sizes

```tsx
// Large button
authClient.initTelegramWidget("container1", { size: "large" }, callback);

// Medium button
authClient.initTelegramWidget("container2", { size: "medium" }, callback);

// Small button
authClient.initTelegramWidget("container3", { size: "small" }, callback);
```

### Custom Styling

```tsx
authClient.initTelegramWidget(
  "telegram-login",
  {
    size: "large",
    showUserPhoto: true,      // Show user's photo
    cornerRadius: 20,         // Rounded corners
    requestAccess: false,     // Don't request write access
    lang: "en",              // Language code
  },
  callback
);
```

## Error Handling

Always handle errors gracefully:

```tsx
try {
  const result = await authClient.signInWithTelegram(authData);

  if (result.error) {
    // Handle authentication error
    switch (result.error.status) {
      case 400:
        setError("Invalid authentication data");
        break;
      case 401:
        setError("Authentication failed. Please try again.");
        break;
      case 500:
        setError("Server error. Please try again later.");
        break;
      default:
        setError(result.error.message);
    }
  } else {
    // Success
    router.push("/dashboard");
  }
} catch (err) {
  // Network or unexpected error
  setError("An unexpected error occurred. Please check your connection.");
}
```

## Best Practices

1. **Always validate auth data** - The plugin does this server-side, but be aware
2. **Handle errors gracefully** - Show user-friendly error messages
3. **Use loading states** - Show feedback during authentication
4. **Clean up widgets** - Remove old widgets when component unmounts if needed
5. **Secure your bot token** - Never expose it to the client
6. **Use HTTPS** - Required by Telegram
7. **Set appropriate session expiry** - Balance security and UX

## Next Steps

- [API Reference](./api-reference.md)
- [Configuration Options](./configuration.md)
- [Security Best Practices](./security.md)
- [Troubleshooting](./troubleshooting.md)
