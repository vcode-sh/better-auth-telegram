import Link from "next/link";
import { SessionDisplay } from "@/components/SessionDisplay";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="mx-auto max-w-4xl space-y-8 py-12">
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-4xl text-gray-900">Dashboard</h1>
          <Link
            className="text-blue-600 underline hover:text-blue-800"
            href="/"
          >
            Back to Home
          </Link>
        </div>

        <SessionDisplay />

        {/* Feature Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-lg bg-white p-6 shadow">
            <h3 className="mb-2 font-semibold text-gray-900 text-lg">
              Login Widget
            </h3>
            <ul className="space-y-2 text-gray-700 text-sm">
              <li className="flex items-center space-x-2">
                <span className="text-green-500">&#10003;</span>
                <span>Telegram Login Widget</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-green-500">&#10003;</span>
                <span>HMAC-SHA-256 Verification</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-green-500">&#10003;</span>
                <span>Session Management</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-green-500">&#10003;</span>
                <span>User Profile Display</span>
              </li>
            </ul>
          </div>

          <div className="rounded-lg bg-white p-6 shadow">
            <h3 className="mb-2 font-semibold text-gray-900 text-lg">
              Security
            </h3>
            <ul className="space-y-2 text-gray-700 text-sm">
              <li className="flex items-center space-x-2">
                <span className="text-blue-500">&#9679;</span>
                <span>auth_date validation (24h)</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-blue-500">&#9679;</span>
                <span>Bot token verification</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-blue-500">&#9679;</span>
                <span>Secure session cookies</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-blue-500">&#9679;</span>
                <span>Phone number privacy</span>
              </li>
            </ul>
          </div>

          <div className="rounded-lg bg-white p-6 shadow">
            <h3 className="mb-2 font-semibold text-gray-900 text-lg">OIDC</h3>
            <ul className="space-y-2 text-gray-700 text-sm">
              <li className="flex items-center space-x-2">
                <span className="text-green-500">&#10003;</span>
                <span>OAuth 2.0 + PKCE</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-green-500">&#10003;</span>
                <span>RS256 JWT via JWKS</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-green-500">&#10003;</span>
                <span>Phone number access</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-green-500">&#10003;</span>
                <span>Bot access permission</span>
              </li>
            </ul>
          </div>
        </div>

        {/* API Endpoints Info */}
        <div className="rounded-lg bg-white p-6 shadow">
          <h3 className="mb-4 font-semibold text-gray-900 text-xl">
            Available API Endpoints
          </h3>
          <div className="space-y-3 font-mono text-sm">
            <div className="flex items-center space-x-3">
              <span className="rounded bg-green-100 px-2 py-1 text-green-800 text-xs">
                POST
              </span>
              <code>/api/auth/telegram/signin</code>
            </div>
            <div className="flex items-center space-x-3">
              <span className="rounded bg-green-100 px-2 py-1 text-green-800 text-xs">
                POST
              </span>
              <code>/api/auth/telegram/link</code>
            </div>
            <div className="flex items-center space-x-3">
              <span className="rounded bg-green-100 px-2 py-1 text-green-800 text-xs">
                POST
              </span>
              <code>/api/auth/telegram/unlink</code>
            </div>
            <div className="flex items-center space-x-3">
              <span className="rounded bg-blue-100 px-2 py-1 text-blue-800 text-xs">
                GET
              </span>
              <code>/api/auth/telegram/config</code>
            </div>
            <div className="flex items-center space-x-3">
              <span className="rounded bg-green-100 px-2 py-1 text-green-800 text-xs">
                POST
              </span>
              <code>/api/auth/telegram/miniapp/signin</code>
            </div>
            <div className="flex items-center space-x-3">
              <span className="rounded bg-green-100 px-2 py-1 text-green-800 text-xs">
                POST
              </span>
              <code>/api/auth/telegram/miniapp/validate</code>
            </div>
            <div className="flex items-center space-x-3">
              <span className="rounded bg-green-100 px-2 py-1 text-green-800 text-xs">
                POST
              </span>
              <code>/api/auth/sign-in/social</code>
              <span className="text-gray-500 text-xs">(OIDC)</span>
            </div>
            <div className="flex items-center space-x-3">
              <span className="rounded bg-blue-100 px-2 py-1 text-blue-800 text-xs">
                GET
              </span>
              <code>/api/auth/callback/telegram-oidc</code>
              <span className="text-gray-500 text-xs">(OIDC callback)</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
