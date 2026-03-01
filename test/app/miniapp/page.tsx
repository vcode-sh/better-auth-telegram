"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

      // Wait for Telegram WebApp SDK to load (max 5 seconds)
      let attempts = 0;
      while (attempts < 50) {
        if ((window as any).Telegram?.WebApp) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      const Telegram = (window as any).Telegram;

      if (!Telegram?.WebApp) {
        setStatus("❌ Not running in Telegram Mini App");
        setError("This page needs to be opened inside a Telegram Mini App. Use @BotFather to create a Mini App and configure the URL.");
        return;
      }

      setStatus("✅ Telegram Mini App detected!");

      const telegramInitData = Telegram.WebApp.initData;

      if (!telegramInitData) {
        setStatus("⚠️ No initData available");
        setError("Telegram.WebApp.initData is empty. Make sure the Mini App is properly configured.");
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
          setError("The initData from Telegram could not be verified. Check your bot token configuration.");
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
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-3xl font-bold mb-6 text-center bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Telegram Mini App Authentication
          </h1>

          <div className="space-y-4">
            {/* Status */}
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-lg font-medium text-blue-900">{status}</p>
            </div>

            {/* Error */}
            {error && (
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <p className="text-sm font-medium text-red-900 mb-2">Error:</p>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* User info */}
            {user && (
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <p className="text-sm font-medium text-green-900 mb-2">User Info:</p>
                <div className="space-y-1 text-sm text-green-700">
                  <p><strong>ID:</strong> {user.id}</p>
                  <p><strong>Name:</strong> {user.name}</p>
                  {user.telegramId && <p><strong>Telegram ID:</strong> {user.telegramId}</p>}
                  {user.telegramUsername && <p><strong>Username:</strong> @{user.telegramUsername}</p>}
                </div>
              </div>
            )}

            {/* InitData preview */}
            {initData && (
              <details className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <summary className="text-sm font-medium text-gray-900 cursor-pointer">
                  InitData (click to expand)
                </summary>
                <pre className="mt-2 text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap break-all">
                  {initData}
                </pre>
              </details>
            )}

            {/* Instructions */}
            <div className="mt-8 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
              <p className="text-sm font-medium text-yellow-900 mb-2">
                📱 How to test this page:
              </p>
              <ol className="text-sm text-yellow-700 space-y-1 list-decimal list-inside">
                <li>Create a Mini App in @BotFather using /newapp</li>
                <li>Set the Web App URL to: <code className="bg-yellow-100 px-1 rounded">{currentUrl}</code></li>
                <li>Open your bot in Telegram</li>
                <li>Click on the Mini App to launch it</li>
                <li>This page will automatically authenticate you!</li>
              </ol>
            </div>

            {/* Manual test section */}
            <div className="mt-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
              <p className="text-sm font-medium text-purple-900 mb-2">
                🧪 Manual Testing (for development):
              </p>
              <p className="text-xs text-purple-700 mb-3">
                If you're not in a Mini App but want to test the validation endpoint:
              </p>
              <button
                onClick={async () => {
                  // This will fail if not in Mini App, but shows the API works
                  try {
                    const testData = "user=%7B%22id%22%3A123%7D&auth_date=" + Math.floor(Date.now() / 1000) + "&hash=test";
                    const result = await authClient.validateMiniApp(testData);
                    alert("Validation result: " + JSON.stringify(result.data));
                  } catch (err: any) {
                    alert("Expected error (invalid hash): " + err.message);
                  }
                }}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
              >
                Test Validation Endpoint
              </button>
            </div>
          </div>
        </div>

        {/* Back button */}
        <div className="mt-6 text-center">
          <button
            onClick={() => router.push("/")}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            ← Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
