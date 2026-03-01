"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OIDCPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOIDCSignIn = async () => {
    setLoading(true);
    setError(null);

    try {
      await authClient.signInWithTelegramOIDC({
        callbackURL: "/dashboard",
        errorCallbackURL: "/oidc?error=auth_failed",
      });
    } catch (err: any) {
      console.error("OIDC sign-in error:", err);
      setError(err.message || "Failed to initiate OIDC sign-in");
      setLoading(false);
    }
  };

  // Check for error in URL params
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const urlError = searchParams?.get("error");

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-3xl font-bold mb-6 text-center bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            Telegram OIDC Authentication
          </h1>

          <div className="space-y-4">
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-green-900 mb-3">
                Uses OAuth 2.0 Authorization Code flow with PKCE via{" "}
                <code className="bg-green-100 px-1 rounded">oauth.telegram.org</code>.
                This redirects you to Telegram's OAuth page where you authorize the bot.
              </p>
              <ul className="text-sm text-green-700 space-y-1 list-disc list-inside">
                <li>RS256 JWT ID token verification via JWKS</li>
                <li>Phone number access (if configured)</li>
                <li>Bot access permission (if configured)</li>
              </ul>
            </div>

            <button
              onClick={handleOIDCSignIn}
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Redirecting to Telegram...
                </span>
              ) : (
                "Sign in with Telegram OIDC"
              )}
            </button>

            {(error || urlError) && (
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <p className="text-sm font-medium text-red-900 mb-1">Error:</p>
                <p className="text-sm text-red-700">{error || urlError}</p>
              </div>
            )}

            <div className="mt-8 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
              <p className="text-sm font-medium text-yellow-900 mb-2">
                Requirements:
              </p>
              <ol className="text-sm text-yellow-700 space-y-1 list-decimal list-inside">
                <li>Server must have <code className="bg-yellow-100 px-1 rounded">oidc.enabled: true</code> in plugin config</li>
                <li>Bot must be configured with @BotFather</li>
                <li>Domain must be set via <code className="bg-yellow-100 px-1 rounded">/setdomain</code> in @BotFather</li>
              </ol>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm font-medium text-gray-900 mb-2">
                How it works:
              </p>
              <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                <li>Click the button above to start the OAuth flow</li>
                <li>You'll be redirected to Telegram's authorization page</li>
                <li>Authorize the bot to access your profile</li>
                <li>Telegram redirects back with an authorization code</li>
                <li>Better Auth exchanges the code for an ID token (JWT)</li>
                <li>The JWT is verified against Telegram's JWKS endpoint</li>
                <li>A session is created and you're redirected to the dashboard</li>
              </ol>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => router.push("/")}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
