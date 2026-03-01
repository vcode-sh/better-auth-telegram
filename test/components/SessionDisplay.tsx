"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

interface Session {
  session: {
    token: string;
    expiresAt: string;
  };
  user: {
    id: string;
    name: string;
    image?: string;
    telegramId?: string;
    telegramUsername?: string;
    telegramPhoneNumber?: string;
  };
}

export function SessionDisplay() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount
  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const result = await authClient.getSession();

      if (result.data) {
        setSession(result.data as any);
      }
    } catch (error) {
      console.error("Failed to get session:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Failed to sign out:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-gray-900 border-b-2" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6">
        <p className="text-yellow-800">No active session. Please sign in.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* User Card */}
      <div className="rounded-lg bg-white p-6 shadow-md">
        <div className="flex items-center space-x-4">
          {session.user.image && (
            <img
              alt={session.user.name}
              className="h-16 w-16 rounded-full"
              height={64}
              src={session.user.image}
              width={64}
            />
          )}
          <div>
            <h2 className="font-bold text-2xl text-gray-900">
              {session.user.name}
            </h2>
            {session.user.telegramUsername && (
              <p className="text-gray-600">@{session.user.telegramUsername}</p>
            )}
          </div>
        </div>

        <div className="mt-6 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">User ID:</span>
            <span className="font-mono text-gray-900">{session.user.id}</span>
          </div>
          {session.user.telegramId && (
            <div className="flex justify-between">
              <span className="text-gray-600">Telegram ID:</span>
              <span className="font-mono text-gray-900">
                {session.user.telegramId}
              </span>
            </div>
          )}
          {session.user.telegramPhoneNumber && (
            <div className="flex justify-between">
              <span className="text-gray-600">Phone Number:</span>
              <span className="font-mono text-gray-900">
                {session.user.telegramPhoneNumber}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-600">Session expires:</span>
            <span className="text-gray-900">
              {new Date(session.session.expiresAt).toLocaleString()}
            </span>
          </div>
        </div>

        <button
          className="mt-6 w-full rounded bg-red-500 px-4 py-2 font-semibold text-white transition duration-200 hover:bg-red-600"
          onClick={handleSignOut}
        >
          Sign Out
        </button>
      </div>

      {/* Debug Info */}
      <details className="rounded-lg bg-gray-100 p-4">
        <summary className="cursor-pointer font-semibold text-gray-700">
          Debug: Session Data
        </summary>
        <pre className="mt-4 overflow-auto rounded border bg-white p-4 text-xs">
          {JSON.stringify(session, null, 2)}
        </pre>
      </details>
    </div>
  );
}
