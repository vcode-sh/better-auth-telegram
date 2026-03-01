import { TelegramLoginButton } from "@/components/TelegramLoginButton";
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Better Auth + Telegram
          </h1>
          <p className="text-gray-600">
            Test app for better-auth-telegram plugin
          </p>
          <div className="mt-4 flex gap-3 justify-center flex-wrap">
            <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">Login Widget</span>
            <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">Mini Apps</span>
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">OIDC</span>
          </div>
        </div>

        <TelegramLoginButton />

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h3 className="font-semibold text-purple-900 mb-2">Mini App Test:</h3>
          <Link
            href="/miniapp"
            className="block w-full text-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            Open Mini App Test Page
          </Link>
          <p className="text-xs text-purple-600 mt-2">
            Full functionality requires opening in Telegram Mini App
          </p>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-900 mb-2">OIDC Test:</h3>
          <Link
            href="/oidc"
            className="block w-full text-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
          >
            Sign in with Telegram OIDC
          </Link>
          <p className="text-xs text-green-600 mt-2">
            OAuth 2.0 Authorization Code flow with PKCE via oauth.telegram.org
          </p>
        </div>

        <div className="text-center space-y-2">
          <Link
            href="/dashboard"
            className="block text-blue-600 hover:text-blue-800 underline"
          >
            Go to Dashboard
          </Link>
          <p className="text-xs text-gray-500">
            (Dashboard requires authentication)
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
          <h3 className="font-semibold text-blue-900 mb-2">Setup Instructions:</h3>
          <ol className="list-decimal list-inside space-y-1 text-blue-800">
            <li>Create a bot with @BotFather on Telegram</li>
            <li>Send <code className="bg-blue-100 px-1 rounded">/setdomain</code> and set to <code className="bg-blue-100 px-1 rounded">localhost</code></li>
            <li>Update <code className="bg-blue-100 px-1 rounded">.env.local</code> with your bot token and username</li>
            <li>Run <code className="bg-blue-100 px-1 rounded">npm install</code> and <code className="bg-blue-100 px-1 rounded">npm run dev</code></li>
          </ol>
        </div>
      </div>
    </main>
  );
}
