import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="mb-2 font-bold text-4xl text-gray-900">
            Better Auth + Telegram
          </h1>
          <p className="text-gray-600">
            Test app for better-auth-telegram plugin
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <span className="rounded-full bg-blue-100 px-3 py-1 font-medium text-blue-700 text-xs">
              Login Widget
            </span>
            <span className="rounded-full bg-purple-100 px-3 py-1 font-medium text-purple-700 text-xs">
              Mini Apps
            </span>
            <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-700 text-xs">
              OIDC
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="mb-2 font-semibold text-blue-900">Login Widget:</h3>
          <Link
            className="block w-full rounded-lg bg-blue-600 px-4 py-2 text-center font-medium text-white transition-colors hover:bg-blue-700"
            href="/widget"
          >
            Sign in with Login Widget
          </Link>
          <p className="mt-2 text-blue-600 text-xs">
            HMAC-SHA-256 verified callback via telegram-widget.js
          </p>
        </div>

        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
          <h3 className="mb-2 font-semibold text-purple-900">Mini App Test:</h3>
          <Link
            className="block w-full rounded-lg bg-purple-600 px-4 py-2 text-center font-medium text-white transition-colors hover:bg-purple-700"
            href="/miniapp"
          >
            Open Mini App Test Page
          </Link>
          <p className="mt-2 text-purple-600 text-xs">
            Full functionality requires opening in Telegram Mini App
          </p>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <h3 className="mb-2 font-semibold text-green-900">OIDC Test:</h3>
          <Link
            className="block w-full rounded-lg bg-green-600 px-4 py-2 text-center font-medium text-white transition-colors hover:bg-green-700"
            href="/oidc"
          >
            Sign in with Telegram OIDC
          </Link>
          <p className="mt-2 text-green-600 text-xs">
            OAuth 2.0 Authorization Code flow with PKCE via oauth.telegram.org
          </p>
        </div>

        <div className="space-y-2 text-center">
          <Link
            className="block text-blue-600 underline hover:text-blue-800"
            href="/dashboard"
          >
            Go to Dashboard
          </Link>
          <p className="text-gray-500 text-xs">
            (Dashboard requires authentication)
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <h3 className="mb-2 font-semibold text-gray-900">
            Setup Instructions:
          </h3>
          <ol className="list-inside list-decimal space-y-1 text-gray-700">
            <li>Create a bot with @BotFather on Telegram</li>
            <li>
              Send <code className="rounded bg-gray-200 px-1">/setdomain</code>{" "}
              and set to your domain
            </li>
            <li>
              Update{" "}
              <code className="rounded bg-gray-200 px-1">.env.local</code> with
              your bot token and username
            </li>
            <li>
              Run <code className="rounded bg-gray-200 px-1">npm install</code>{" "}
              and <code className="rounded bg-gray-200 px-1">npm run dev</code>
            </li>
          </ol>
        </div>
      </div>
    </main>
  );
}
