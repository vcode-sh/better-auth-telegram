import type {
  BetterAuthClientPlugin,
  BetterFetch,
  ClientStore,
} from "better-auth/client";
import type {
  FetchOptions,
  TelegramClientError,
  TelegramConfigResponse,
  TelegramLinkResponse,
  TelegramSignInResponse,
} from "./client-types";
import { createTelegramWidgetActions } from "./client-widget";
import { TELEGRAM_ERROR_CODES } from "./error-codes";
import type { telegram } from "./index";
import type { TelegramAuthData } from "./types";

export type {
  TelegramClientError,
  TelegramLinkResponse,
  TelegramSignInResponse,
  TelegramUser,
} from "./client-types";
export type { TelegramWidget, TelegramWidgetOptions } from "./client-widget";
// biome-ignore lint/performance/noBarrelFile: Preserve the package's public client exports.
export { TELEGRAM_ERROR_CODES } from "./error-codes";

type TelegramPlugin = typeof telegram;

function getMiniAppInitData(): string | undefined {
  const sdkInitData = (window as any).Telegram?.WebApp?.initData;
  if (sdkInitData) {
    return sdkInitData;
  }

  // The launch URL also carries initData, so the SDK need not load first.
  try {
    const { hash } = window.location;
    if (!hash) {
      return undefined;
    }

    return new URLSearchParams(hash.slice(1)).get("tgWebAppData") || undefined;
  } catch {
    return undefined;
  }
}

/** Routes after which the signed-in user (or their Telegram identity) changed. */
const SESSION_CHANGING_PATHS = new Set([
  "/telegram/signin",
  "/telegram/link",
  "/telegram/unlink",
  "/telegram/miniapp/signin",
]);

/**
 * Client plugin for Telegram authentication
 */
export const telegramClient = () => {
  return {
    id: "telegram",
    $InferServerPlugin: {} as ReturnType<TelegramPlugin>,
    $ERROR_CODES: TELEGRAM_ERROR_CODES,

    // Refreshes `useSession` after the generated routes
    // (`authClient.telegram.signin(...)`), like Better Auth's own plugins.
    atomListeners: [
      {
        matcher: (path: string) => SESSION_CHANGING_PATHS.has(path),
        signal: "$sessionSignal",
      },
    ],

    getActions: ($fetch: BetterFetch, $store: ClientStore) => {
      /**
       * Calls a session-changing route and, when it succeeds, tells
       * `useSession` to refetch (as Better Auth's oauth-popup client does).
       */
      const changeSession = async <Res>(
        path: string,
        fetchOptions: FetchOptions & { body?: unknown }
      ) => {
        const response = await $fetch<Res, TelegramClientError>(path, {
          method: "POST",
          ...fetchOptions,
        });
        if (!(response.error || fetchOptions.disableSignal)) {
          $store.notify("$sessionSignal");
        }
        return response;
      };

      return {
        /**
         * Sign in with Telegram
         * @param authData - Authentication data from Telegram Login Widget
         * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
         */
        signInWithTelegram: async (
          authData: TelegramAuthData,
          fetchOptions?: FetchOptions
        ) =>
          await changeSession<TelegramSignInResponse>("/telegram/signin", {
            body: authData,
            ...fetchOptions,
          }),

        /**
         * Link current user account with Telegram
         * @param authData - Authentication data from Telegram Login Widget
         * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
         */
        linkTelegram: async (
          authData: TelegramAuthData,
          fetchOptions?: FetchOptions
        ) =>
          await changeSession<TelegramLinkResponse>("/telegram/link", {
            body: authData,
            ...fetchOptions,
          }),

        /**
         * Unlink Telegram account from current user
         * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
         */
        unlinkTelegram: async (fetchOptions?: FetchOptions) =>
          await changeSession<TelegramLinkResponse>("/telegram/unlink", {
            ...fetchOptions,
          }),

        /**
         * Get Telegram bot configuration
         * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
         */
        getTelegramConfig: async (fetchOptions?: FetchOptions) => {
          const response = await $fetch<
            TelegramConfigResponse,
            TelegramClientError
          >("/telegram/config", {
            method: "GET",
            ...fetchOptions,
          });

          return response;
        },

        ...createTelegramWidgetActions($fetch),

        /**
         * Sign in with Telegram Mini App
         * @param initData - Raw initData string from Telegram.WebApp.initData
         *
         * @example
         * ```ts
         * // Inside a Telegram Mini App
         * const initData = window.Telegram.WebApp.initData;
         * const result = await signInWithMiniApp(initData);
         * console.log("Signed in:", result);
         * ```
         */
        signInWithMiniApp: async (
          initData: string,
          fetchOptions?: FetchOptions
        ) =>
          await changeSession<TelegramSignInResponse>(
            "/telegram/miniapp/signin",
            {
              body: { initData },
              ...fetchOptions,
            }
          ),

        /**
         * Validate Telegram Mini App initData
         * @param initData - Raw initData string from Telegram.WebApp.initData
         * @returns Object with valid status and parsed data if valid
         *
         * @example
         * ```ts
         * const initData = window.Telegram.WebApp.initData;
         * const result = await validateMiniApp(initData);
         * if (result.data?.valid) {
         *   console.log("User:", result.data.data?.user);
         * }
         * ```
         */
        validateMiniApp: async (
          initData: string,
          fetchOptions?: FetchOptions
        ) => {
          const response = await $fetch<
            { valid: boolean; data: any },
            TelegramClientError
          >("/telegram/miniapp/validate", {
            method: "POST",
            body: { initData },
            ...fetchOptions,
          });

          return response;
        },

        /**
         * Auto sign-in from Telegram Mini App
         * Automatically retrieves initData from Telegram.WebApp and signs in
         * Only works when running inside a Telegram Mini App
         *
         * @example
         * ```ts
         * // Auto-signin when Mini App launches
         * try {
         *   const result = await autoSignInFromMiniApp();
         *   console.log("Auto signed in:", result);
         * } catch (error) {
         *   console.error("Not running in Mini App or auth failed");
         * }
         * ```
         */
        autoSignInFromMiniApp: async (fetchOptions?: FetchOptions) => {
          if (typeof window === "undefined") {
            throw new Error("This method can only be called in browser");
          }

          const initData = getMiniAppInitData();
          if (!initData) {
            throw new Error(
              "Not running in Telegram Mini App or initData not available"
            );
          }

          return await changeSession<TelegramSignInResponse>(
            "/telegram/miniapp/signin",
            {
              body: { initData },
              ...fetchOptions,
            }
          );
        },

        /**
         * Sign in with Telegram OIDC (OpenID Connect)
         * Initiates the standard OAuth 2.0 Authorization Code flow with PKCE
         * via oauth.telegram.org. Requires `oidc.enabled: true` on the server.
         *
         * @param options - Callback URLs for redirect after authentication
         * @param fetchOptions - Optional fetch options
         *
         * @example
         * ```ts
         * await authClient.signInWithTelegramOIDC({
         *   callbackURL: "/dashboard",
         * });
         * ```
         */
        signInWithTelegramOIDC: async (
          options?: {
            callbackURL?: string;
            errorCallbackURL?: string;
          },
          fetchOptions?: FetchOptions
        ) =>
          await $fetch<{ url: string; redirect: boolean }, TelegramClientError>(
            "/sign-in/social",
            {
              method: "POST",
              body: {
                provider: "telegram-oidc",
                callbackURL: options?.callbackURL,
                errorCallbackURL: options?.errorCallbackURL,
              },
              ...fetchOptions,
            }
          ),
      };
    },
  } satisfies BetterAuthClientPlugin;
};

export default telegramClient;
