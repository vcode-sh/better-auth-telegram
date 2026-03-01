"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function MiniAppPage() {
  const router = useRouter();
  const [status, setStatus] = useState<string>("Checking Telegram Mini App...");
  const [error, setError] = useState<string | null>(null);
  const [initData, setInitData] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [currentUrl, setCurrentUrl] = useState<string>("[your-url]/miniapp");

  useEffect(() => {
    async function checkMiniApp() {
      // Check if running in Telegram Mini App
      if (typeof window === "undefined") {
        setStatus("Server-side rendering...");
        return;
      }

      // Set current URL on client side only
      setCurrentUrl(window.location.href);

      setStatus("⏳ Loading Telegram WebApp SDK...");

      // Load telegram-web-app.js if not already present
      if (!document.querySelector('script[src*="telegram-web-app.js"]')) {
        const script = document.createElement("script");
        script.src = "https://telegram.org/js/telegram-web-app.js";
        script.async = true;
        document.head.appendChild(script);
      }

      // Wait for Telegram WebApp SDK to load (max 5 seconds)
      let attempts = 0;
      while (attempts < 50) {
        if ((window as any).Telegram?.WebApp) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      const Telegram = (window as any).Telegram;

      if (!Telegram?.WebApp) {
        setStatus("❌ Not running in Telegram Mini App");
        setError(
          "This page needs to be opened inside a Telegram Mini App. Use @BotFather to create a Mini App and configure the URL."
        );
        return;
      }

      setStatus("✅ Telegram Mini App detected!");

      const telegramInitData = Telegram.WebApp.initData;

      if (!telegramInitData) {
        setStatus("⚠️ No initData available");
        setError(
          "Telegram.WebApp.initData is empty. Make sure the Mini App is properly configured."
        );
        return;
      }

      setInitData(telegramInitData);
      setStatus("🔄 Validating initData...");

      try {
        // Validate initData
        const validation = await authClient.validateMiniApp(telegramInitData);

        if (validation.data?.valid) {
          setStatus("✅ InitData valid! Signing in...");

          // Auto sign-in
          const result = await authClient.autoSignInFromMiniApp();

          const data = result.data as any;
          if (data?.user) {
            setUser(data.user);
            setStatus("✅ Signed in successfully!");

            // Redirect to dashboard after 2 seconds
            setTimeout(() => {
              router.push("/dashboard");
            }, 2000);
          } else {
            setError("Failed to get user data from sign-in response");
          }
        } else {
          setStatus("❌ InitData validation failed");
          setError(
            "The initData from Telegram could not be verified. Check your bot token configuration."
          );
        }
      } catch (err: any) {
        setStatus("❌ Error during authentication");
        setError(err.message || "Unknown error occurred");
        console.error("Mini App auth error:", err);
      }
    }

    checkMiniApp();
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-8">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <h1 className="mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-center font-bold text-3xl text-transparent">
            Telegram Mini App Authentication
          </h1>

          <div className="space-y-4">
            {/* Status */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="font-medium text-blue-900 text-lg">{status}</p>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="mb-2 font-medium text-red-900 text-sm">Error:</p>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            {/* User info */}
            {user && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="mb-2 font-medium text-green-900 text-sm">
                  User Info:
                </p>
                <div className="space-y-1 text-green-700 text-sm">
                  <p>
                    <strong>ID:</strong> {user.id}
                  </p>
                  <p>
                    <strong>Name:</strong> {user.name}
                  </p>
                  {user.telegramId && (
                    <p>
                      <strong>Telegram ID:</strong> {user.telegramId}
                    </p>
                  )}
                  {user.telegramUsername && (
                    <p>
                      <strong>Username:</strong> @{user.telegramUsername}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* InitData preview */}
            {initData && (
              <details className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <summary className="cursor-pointer font-medium text-gray-900 text-sm">
                  InitData (click to expand)
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-gray-600 text-xs">
                  {initData}
                </pre>
              </details>
            )}

            {/* Instructions */}
            <div className="mt-8 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <p className="mb-2 font-medium text-sm text-yellow-900">
                📱 How to test this page:
              </p>
              <ol className="list-inside list-decimal space-y-1 text-sm text-yellow-700">
                <li>Create a Mini App in @BotFather using /newapp</li>
                <li>
                  Set the Web App URL to:{" "}
                  <code className="rounded bg-yellow-100 px-1">
                    {currentUrl}
                  </code>
                </li>
                <li>Open your bot in Telegram</li>
                <li>Click on the Mini App to launch it</li>
                <li>This page will automatically authenticate you!</li>
              </ol>
            </div>

            {/* Manual test section */}
            <div className="mt-6 rounded-lg border border-purple-200 bg-purple-50 p-4">
              <p className="mb-2 font-medium text-purple-900 text-sm">
                🧪 Manual Testing (for development):
              </p>
              <p className="mb-3 text-purple-700 text-xs">
                If you're not in a Mini App but want to test the validation
                endpoint:
              </p>
              <button
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white transition-colors hover:bg-purple-700"
                onClick={async () => {
                  // This will fail if not in Mini App, but shows the API works
                  try {
                    const testData = `user=%7B%22id%22%3A123%7D&auth_date=${Math.floor(Date.now() / 1000)}&hash=test`;
                    const result = await authClient.validateMiniApp(testData);
                    console.log(
                      `Validation result: ${JSON.stringify(result.data)}`
                    );
                  } catch (err: any) {
                    console.log(
                      `Expected error (invalid hash): ${err.message}`
                    );
                  }
                }}
              >
                Test Validation Endpoint
              </button>
            </div>
          </div>
        </div>

        {/* Back button */}
        <div className="mt-6 text-center">
          <button
            className="font-medium text-blue-600 text-sm hover:text-blue-700"
            onClick={() => router.push("/")}
          >
            ← Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
