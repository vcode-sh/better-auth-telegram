// Component for Telegram Login
// app/components/TelegramLoginButton.tsx

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

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
            const _result = await authClient.signInWithTelegram(authData);

            // Redirect to dashboard or home
            router.push("/dashboard");
          } catch (_err) {
            setError("Failed to sign in with Telegram");
          } finally {
            setLoading(false);
          }
        }
      )
      .catch((_err) => {
        setError("Failed to load Telegram login widget");
      });
  }, [router]);

  return (
    <div className="flex flex-col items-center space-y-4">
      <div id="telegram-login-container" />

      {loading && (
        <div className="text-gray-600 text-sm">Signing in with Telegram...</div>
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}
    </div>
  );
}
