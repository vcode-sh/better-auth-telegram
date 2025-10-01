// Component for linking Telegram to existing account
// app/components/TelegramLinkButton.tsx

"use client";

import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

export function TelegramLinkButton() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Initialize Telegram Login Widget for linking
    authClient
      .initTelegramWidget(
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

          try {
            await authClient.linkTelegram(authData);
            setSuccess(true);
          } catch (err: any) {
            console.error("Link failed:", err);
            setError(err?.message || "Failed to link Telegram account");
          } finally {
            setLoading(false);
          }
        }
      )
      .catch((err) => {
        console.error("Failed to initialize widget:", err);
        setError("Failed to load Telegram widget");
      });
  }, []);

  const handleUnlink = async () => {
    setLoading(true);
    setError(null);

    try {
      await authClient.unlinkTelegram();
      setSuccess(false);
      window.location.reload(); // Refresh to show link button again
    } catch (err: any) {
      console.error("Unlink failed:", err);
      setError(err?.message || "Failed to unlink Telegram account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      <h3 className="text-lg font-semibold">Link Telegram Account</h3>

      {!success && (
        <div id="telegram-link-container"></div>
      )}

      {success && (
        <div className="space-y-2">
          <div className="text-sm text-green-600">
            ✓ Telegram account linked successfully!
          </div>
          <button
            onClick={handleUnlink}
            disabled={loading}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
          >
            {loading ? "Unlinking..." : "Unlink Telegram"}
          </button>
        </div>
      )}

      {loading && !success && (
        <div className="text-sm text-gray-600">
          Processing...
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
