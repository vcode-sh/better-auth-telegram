"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

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
  const searchParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const urlError = searchParams?.get("error");

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-8">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <h1 className="mb-6 bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-center font-bold text-3xl text-transparent">
            Telegram OIDC Authentication
          </h1>

          <div className="space-y-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="mb-3 text-green-900 text-sm">
                Uses OAuth 2.0 Authorization Code flow with PKCE via{" "}
                <code className="rounded bg-green-100 px-1">
                  oauth.telegram.org
                </code>
                . This redirects you to Telegram's OAuth page where you
                authorize the bot.
              </p>
              <ul className="list-inside list-disc space-y-1 text-green-700 text-sm">
                <li>RS256 JWT ID token verification via JWKS</li>
                <li>Phone number access (if configured)</li>
                <li>Bot access permission (if configured)</li>
              </ul>
            </div>

            <button
              className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading}
              onClick={handleOIDCSignIn}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-white border-b-2" />
                  Redirecting to Telegram...
                </span>
              ) : (
                "Sign in with Telegram OIDC"
              )}
            </button>

            {(error || urlError) && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="mb-1 font-medium text-red-900 text-sm">Error:</p>
                <p className="text-red-700 text-sm">{error || urlError}</p>
              </div>
            )}

            <div className="mt-8 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <p className="mb-2 font-medium text-sm text-yellow-900">
                Requirements:
              </p>
              <ol className="list-inside list-decimal space-y-1 text-sm text-yellow-700">
                <li>
                  Server must have{" "}
                  <code className="rounded bg-yellow-100 px-1">
                    oidc.enabled: true
                  </code>{" "}
                  in plugin config
                </li>
                <li>Bot must be configured with @BotFather</li>
                <li>
                  Domain must be set via{" "}
                  <code className="rounded bg-yellow-100 px-1">/setdomain</code>{" "}
                  in @BotFather
                </li>
              </ol>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="mb-2 font-medium text-gray-900 text-sm">
                How it works:
              </p>
              <ol className="list-inside list-decimal space-y-1 text-gray-700 text-sm">
                <li>Click the button above to start the OAuth flow</li>
                <li>You'll be redirected to Telegram's authorization page</li>
                <li>Authorize the bot to access your profile</li>
                <li>Telegram redirects back with an authorization code</li>
                <li>Better Auth exchanges the code for an ID token (JWT)</li>
                <li>The JWT is verified against Telegram's JWKS endpoint</li>
                <li>
                  A session is created and you're redirected to the dashboard
                </li>
              </ol>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <button
            className="font-medium text-blue-600 text-sm hover:text-blue-700"
            onClick={() => router.push("/")}
          >
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
