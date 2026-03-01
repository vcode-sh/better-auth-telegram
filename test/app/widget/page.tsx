"use client";

import { useRouter } from "next/navigation";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";

export default function WidgetPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-8">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <h1 className="mb-6 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-center font-bold text-3xl text-transparent">
            Telegram Login Widget
          </h1>

          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="mb-3 text-blue-900 text-sm">
                Uses HMAC-SHA-256 verification via{" "}
                <code className="rounded bg-blue-100 px-1">
                  telegram-widget.js
                </code>
                . The widget renders a Telegram login button and handles
                authentication via a callback.
              </p>
              <ul className="list-inside list-disc space-y-1 text-blue-700 text-sm">
                <li>HMAC-SHA-256 data verification</li>
                <li>auth_date replay protection (24h)</li>
                <li>Session cookie management</li>
              </ul>
            </div>

            <TelegramLoginButton />
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
