// Component for Telegram Login
// app/components/TelegramLoginButton.tsx

"use client";

import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { useRouter } from "next/navigation";

export function TelegramLoginButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Initialize Telegram Login Widget
    authClient
      .initTelegramWidget(
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
            console.log("Signed in successfully:", result);

            // Redirect to dashboard or home
            router.push("/dashboard");
          } catch (err) {
            console.error("Sign in failed:", err);
            setError("Failed to sign in with Telegram");
          } finally {
            setLoading(false);
          }
        }
      )
      .catch((err) => {
        console.error("Failed to initialize widget:", err);
        setError("Failed to load Telegram login widget");
      });
  }, [router]);

  return (
    <div className="flex flex-col items-center space-y-4">
      <div id="telegram-login-container"></div>

      {loading && (
        <div className="text-sm text-gray-600">
          Signing in with Telegram...
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
