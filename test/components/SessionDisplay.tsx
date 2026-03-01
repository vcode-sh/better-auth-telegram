"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

interface Session {
  user: {
    id: string;
    name: string;
    image?: string;
    telegramId?: string;
    telegramUsername?: string;
    telegramPhoneNumber?: string;
  };
  session: {
    token: string;
    expiresAt: string;
  };
}

export function SessionDisplay() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

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
      <div className="flex justify-center items-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-yellow-800">No active session. Please sign in.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* User Card */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center space-x-4">
          {session.user.image && (
            <img
              src={session.user.image}
              alt={session.user.name}
              className="w-16 h-16 rounded-full"
            />
          )}
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
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
              <span className="font-mono text-gray-900">{session.user.telegramId}</span>
            </div>
          )}
          {session.user.telegramPhoneNumber && (
            <div className="flex justify-between">
              <span className="text-gray-600">Phone Number:</span>
              <span className="font-mono text-gray-900">{session.user.telegramPhoneNumber}</span>
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
          onClick={handleSignOut}
          className="mt-6 w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded transition duration-200"
        >
          Sign Out
        </button>
      </div>

      {/* Debug Info */}
      <details className="bg-gray-100 rounded-lg p-4">
        <summary className="cursor-pointer font-semibold text-gray-700">
          Debug: Session Data
        </summary>
        <pre className="mt-4 text-xs overflow-auto bg-white p-4 rounded border">
          {JSON.stringify(session, null, 2)}
        </pre>
      </details>
    </div>
  );
}
