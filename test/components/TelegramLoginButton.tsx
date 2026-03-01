"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

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
            setError(
              err instanceof Error
                ? err.message
                : "Failed to sign in with Telegram"
            );
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
    <div className="flex flex-col items-center space-y-4 rounded-lg bg-white p-6 shadow-md">
      <h2 className="font-bold text-2xl text-gray-800">
        Sign in with Telegram
      </h2>

      <div className="min-h-[50px]" id="telegram-login-container" />

      {loading && (
        <div className="flex items-center space-x-2 text-blue-600">
          <div className="h-4 w-4 animate-spin rounded-full border-blue-600 border-b-2" />
          <span className="text-sm">Signing in...</span>
        </div>
      )}

      {success && (
        <div className="flex items-center space-x-2 text-green-600 text-sm">
          <svg
            aria-label="Success"
            className="h-4 w-4"
            fill="currentColor"
            role="img"
            viewBox="0 0 20 20"
          >
            <path
              clipRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              fillRule="evenodd"
            />
          </svg>
          <span>Successfully signed in! Redirecting...</span>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-red-600 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="max-w-md text-center text-gray-500 text-xs">
        <p>
          By signing in, you agree to share your Telegram name, username, and
          profile picture. Your phone number remains private.
        </p>
      </div>
    </div>
  );
}
