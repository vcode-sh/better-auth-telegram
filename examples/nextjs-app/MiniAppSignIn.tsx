// Mini App auto sign-in component
// app/components/MiniAppSignIn.tsx
// Only use this inside a Telegram Mini App context

"use client";

import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

export function MiniAppSignIn() {
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const signIn = async () => {
      setStatus("loading");

      try {
        const result = await authClient.autoSignInFromMiniApp();
        if (result.error) {
          setError(result.error.message);
          setStatus("error");
        } else {
          setStatus("success");
        }
      } catch {
        setError("Failed to auto sign-in from Mini App");
        setStatus("error");
      }
    };

    // Only attempt if running inside a Telegram Mini App
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      signIn();
    }
  }, []);

  if (status === "loading") {
    return <div>Signing in...</div>;
  }

  if (status === "error") {
    return <div className="text-red-600">{error}</div>;
  }

  if (status === "success") {
    return (
      <div className="text-green-600">Signed in via Telegram Mini App</div>
    );
  }

  return (
    <div className="text-gray-500">Not running inside a Telegram Mini App</div>
  );
}
