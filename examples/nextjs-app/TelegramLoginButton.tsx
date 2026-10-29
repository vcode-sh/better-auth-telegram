// Login Widget component
// app/components/TelegramLoginButton.tsx

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "../lib/auth-client";

export function TelegramLoginButton() {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const host = document.createElement("div");
    container.current.appendChild(host);
    const widget = authClient.initTelegramWidget(
      host,
      {
        size: "large",
        showUserPhoto: true,
        cornerRadius: 20,
        lang: "en",
      },
      async (authData) => {
        setLoading(true);
        setError(null);
        // Actions return { data, error }; they don't throw for HTTP errors.
        const result = await authClient.signInWithTelegram(authData);
        setLoading(false);
        if (result.error) {
          setError(result.error.message ?? "Failed to sign in with Telegram");
          return;
        }
        // useSession() has already picked up the new session.
        router.push("/dashboard");
      }
    );
    widget.catch(() => {
      if (host.isConnected) setError("Failed to load Telegram login widget");
    });
    // React strict mode and HMR re-run effects: remove the old widget.
    return () => {
      host.remove();
      widget.then((w) => w.destroy()).catch(() => undefined);
    };
  }, [router]);

  return (
    <div className="flex flex-col items-center space-y-4">
      <div ref={container} />

      {loading && (
        <div className="text-gray-600 text-sm">Signing in with Telegram...</div>
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}
    </div>
  );
}
