"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function TelegramLoginButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
            console.log("Telegram auth data received:", authData);

            const result = await authClient.signInWithTelegram(authData);

            console.log("Sign in result:", result);

            if (result.error) {
              setError(result.error.message || "Failed to sign in");
              return;
            }

            setSuccess(true);

            // Redirect to dashboard
            setTimeout(() => {
              router.push("/dashboard");
              router.refresh();
            }, 1000);
          } catch (err) {
            console.error("Sign in error:", err);
            setError(err instanceof Error ? err.message : "Failed to sign in with Telegram");
          } finally {
            setLoading(false);
          }
        }
      )
      .catch((err) => {
        console.error("Failed to initialize Telegram widget:", err);
        setError("Failed to load Telegram login widget");
      });
  }, [router]);

  return (
    <div className="flex flex-col items-center space-y-4 p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800">
        Sign in with Telegram
      </h2>

      <div id="telegram-login-container" className="min-h-[50px]"></div>

      {loading && (
        <div className="flex items-center space-x-2 text-blue-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          <span className="text-sm">Signing in...</span>
        </div>
      )}

      {success && (
        <div className="text-sm text-green-600 flex items-center space-x-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>Successfully signed in! Redirecting...</span>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-200">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="text-xs text-gray-500 text-center max-w-md">
        <p>
          By signing in, you agree to share your Telegram name, username, and profile picture.
          Your phone number remains private.
        </p>
      </div>
    </div>
  );
}
