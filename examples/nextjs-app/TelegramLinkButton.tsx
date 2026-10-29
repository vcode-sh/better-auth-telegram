// Account linking component
// app/components/TelegramLinkButton.tsx

"use client";

import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

export function TelegramLinkButton() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const widget = authClient.initTelegramWidget(
      "telegram-link-container",
      {
        size: "medium",
        showUserPhoto: true,
        cornerRadius: 10,
      },
      async (authData) => {
        setLoading(true);
        setError(null);
        setSuccess(false);
        // Actions return { data, error }; a 409 or 401 does not throw.
        const result = await authClient.linkTelegram(authData);
        setLoading(false);
        if (result.error) {
          setError(result.error.message ?? "Failed to link Telegram account");
          return;
        }
        setSuccess(true);
      }
    );
    widget.catch(() => {
      setError("Failed to load Telegram widget");
    });
    return () => {
      widget.then((w) => w.destroy()).catch(() => undefined);
    };
  }, []);

  const handleUnlink = async () => {
    setLoading(true);
    setError(null);
    const result = await authClient.unlinkTelegram();
    setLoading(false);
    if (result.error) {
      // e.g. CANNOT_UNLINK_LAST_ACCOUNT, SESSION_NOT_FRESH
      setError(result.error.message ?? "Failed to unlink Telegram account");
      return;
    }
    // useSession() updates by itself; no reload needed.
    setSuccess(false);
  };

  return (
    <div className="flex flex-col space-y-4">
      <h3 className="font-semibold text-lg">Link Telegram Account</h3>

      {!success && <div id="telegram-link-container" />}

      {success && (
        <div className="space-y-2">
          <div className="text-green-600 text-sm">
            Telegram account linked successfully
          </div>
          <button
            className="rounded bg-red-500 px-4 py-2 text-white hover:bg-red-600 disabled:opacity-50"
            disabled={loading}
            onClick={handleUnlink}
          >
            {loading ? "Unlinking..." : "Unlink Telegram"}
          </button>
        </div>
      )}

      {loading && !success && (
        <div className="text-gray-600 text-sm">Processing...</div>
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}
    </div>
  );
}
