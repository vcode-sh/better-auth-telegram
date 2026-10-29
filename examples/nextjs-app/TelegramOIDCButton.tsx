// OIDC sign-in component
// app/components/TelegramOIDCButton.tsx

"use client";

import { useState } from "react";
import { authClient } from "../lib/auth-client";

export function TelegramOIDCButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);

    const result = await authClient.signInWithTelegramOIDC({
      callbackURL: "/dashboard",
      errorCallbackURL: "/login",
    });
    if (result.error) {
      setError(result.error.message ?? "Failed to start OIDC flow");
      setLoading(false);
      return;
    }
    // Better Auth's client follows result.data.url to oauth.telegram.org.
    // A user who declines there sends no callback: keep a way back on /login.
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      <button
        className="rounded bg-blue-500 px-6 py-3 font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
        disabled={loading}
        onClick={handleSignIn}
      >
        {loading ? "Redirecting..." : "Sign in with Telegram"}
      </button>

      {error && <div className="text-red-600 text-sm">{error}</div>}
    </div>
  );
}
