import type { BetterAuthClientPlugin } from "better-auth/client";
import type { telegram } from "./index";
import type { TelegramAuthData } from "./types";

type TelegramPlugin = typeof telegram;

/**
 * Options that can be passed to fetch calls for customization
 * (e.g., custom headers, cache control, credentials)
 */
type FetchOptions = Record<string, any>;

/**
 * Telegram Login Widget script URL
 */
const TELEGRAM_WIDGET_SCRIPT = "https://telegram.org/js/telegram-widget.js?22";

/**
 * Options for initializing Telegram Login Widget
 */
export interface TelegramWidgetOptions {
  /**
   * Corner radius of the button
   * @default 20
   */
  cornerRadius?: number;

  /**
   * Language code (e.g., "en", "pl")
   */
  lang?: string;

  /**
   * Request write access permission
   * @default false
   */
  requestAccess?: boolean;

  /**
   * Whether to show user photo
   * @default true
   */
  showUserPhoto?: boolean;
  /**
   * Size of the login button
   * @default "large"
   */
  size?: "large" | "medium" | "small";
}

/**
 * Helper to load Telegram Widget script
 */
function loadTelegramWidgetScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if script already loaded
    if ((window as any).Telegram?.Login) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = TELEGRAM_WIDGET_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Telegram widget script"));
    document.head.appendChild(script);
  });
}

/**
 * Client plugin for Telegram authentication
 */
export const telegramClient = () => {
  return {
    id: "telegram",
    $InferServerPlugin: {} as ReturnType<TelegramPlugin>,

    getActions: ($fetch) => ({
      /**
       * Sign in with Telegram
       * @param authData - Authentication data from Telegram Login Widget
       * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
       */
      signInWithTelegram: async (
        authData: TelegramAuthData,
        fetchOptions?: FetchOptions
      ) => {
        const response = await $fetch("/telegram/signin", {
          method: "POST",
          body: authData,
          ...fetchOptions,
        });

        return response;
      },

      /**
       * Link current user account with Telegram
       * @param authData - Authentication data from Telegram Login Widget
       * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
       */
      linkTelegram: async (
        authData: TelegramAuthData,
        fetchOptions?: FetchOptions
      ) => {
        const response = await $fetch("/telegram/link", {
          method: "POST",
          body: authData,
          ...fetchOptions,
        });

        return response;
      },

      /**
       * Unlink Telegram account from current user
       * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
       */
      unlinkTelegram: async (fetchOptions?: FetchOptions) => {
        const response = await $fetch("/telegram/unlink", {
          method: "POST",
          ...fetchOptions,
        });

        return response;
      },

      /**
       * Get Telegram bot configuration
       * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
       */
      getTelegramConfig: async (fetchOptions?: FetchOptions) => {
        const response = await $fetch<{
          botUsername: string;
          testMode: boolean;
        }>("/telegram/config", {
          method: "GET",
          ...fetchOptions,
        });

        return response;
      },

      /**
       * Initialize Telegram Login Widget
       * This function creates a Telegram login button and handles the authentication flow
       *
       * @param containerId - ID of the container element where the widget will be rendered
       * @param options - Widget configuration options
       * @param onAuth - Callback function called when user successfully authenticates
       *
       * @example
       * ```ts
       * await initTelegramWidget("telegram-login-container", {
       *   size: "large",
       *   showUserPhoto: true
       * }, async (authData) => {
       *   const result = await signInWithTelegram(authData);
       *   console.log("Signed in:", result);
       * });
       * ```
       */
      initTelegramWidget: async (
        containerId: string,
        options: TelegramWidgetOptions = {},
        onAuth: (authData: TelegramAuthData) => void | Promise<void>
      ) => {
        // Load Telegram widget script
        await loadTelegramWidgetScript();

        // Get bot username from server
        const configResponse = await $fetch<{ botUsername: string }>(
          "/telegram/config",
          {
            method: "GET",
          }
        );

        if (!configResponse.data) {
          throw new Error("Failed to get Telegram config");
        }

        const config = configResponse.data;
        const {
          size = "large",
          showUserPhoto = true,
          cornerRadius = 20,
          requestAccess = false,
          lang,
        } = options;

        const container = document.getElementById(containerId);
        if (!container) {
          throw new Error(`Container with id "${containerId}" not found`);
        }

        // Clear container
        container.innerHTML = "";

        // Create callback function
        const callbackName = `telegramCallback_${Date.now()}`;
        (window as any)[callbackName] = (authData: TelegramAuthData) => {
          onAuth(authData);
          // Clean up
          delete (window as any)[callbackName];
        };

        // Create widget script
        const script = document.createElement("script");
        script.src = TELEGRAM_WIDGET_SCRIPT;
        script.async = true;
        script.setAttribute("data-telegram-login", config.botUsername);
        script.setAttribute("data-size", size);
        script.setAttribute("data-userpic", showUserPhoto.toString());
        script.setAttribute("data-radius", cornerRadius.toString());
        script.setAttribute("data-onauth", `${callbackName}(user)`);

        if (requestAccess) {
          script.setAttribute("data-request-access", "write");
        }

        if (lang) {
          script.setAttribute("data-lang", lang);
        }

        container.appendChild(script);
      },

      /**
       * Alternative method: Use Telegram Login with redirect
       *
       * @param redirectUrl - URL to redirect after successful authentication
       * @param options - Widget configuration options
       *
       * @example
       * ```ts
       * await initTelegramWidgetRedirect(
       *   "/auth/telegram/callback",
       *   { size: "medium" }
       * );
       * ```
       */
      initTelegramWidgetRedirect: async (
        containerId: string,
        redirectUrl: string,
        options: TelegramWidgetOptions = {}
      ) => {
        // Load Telegram widget script
        await loadTelegramWidgetScript();

        // Get bot username from server
        const configResponse = await $fetch<{ botUsername: string }>(
          "/telegram/config",
          {
            method: "GET",
          }
        );

        if (!configResponse.data) {
          throw new Error("Failed to get Telegram config");
        }

        const config = configResponse.data;
        const {
          size = "large",
          showUserPhoto = true,
          cornerRadius = 20,
          requestAccess = false,
          lang,
        } = options;

        const container = document.getElementById(containerId);
        if (!container) {
          throw new Error(`Container with id "${containerId}" not found`);
        }

        // Clear container
        container.innerHTML = "";

        // Create widget script with redirect
        const script = document.createElement("script");
        script.src = TELEGRAM_WIDGET_SCRIPT;
        script.async = true;
        script.setAttribute("data-telegram-login", config.botUsername);
        script.setAttribute("data-size", size);
        script.setAttribute("data-userpic", showUserPhoto.toString());
        script.setAttribute("data-radius", cornerRadius.toString());
        script.setAttribute("data-auth-url", redirectUrl);

        if (requestAccess) {
          script.setAttribute("data-request-access", "write");
        }

        if (lang) {
          script.setAttribute("data-lang", lang);
        }

        container.appendChild(script);
      },

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
      ) => {
        const response = await $fetch("/telegram/miniapp/signin", {
          method: "POST",
          body: { initData },
          ...fetchOptions,
        });

        return response;
      },

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
        const response = await $fetch<{
          valid: boolean;
          data: any;
        }>("/telegram/miniapp/validate", {
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

        const Telegram = (window as any).Telegram;
        if (!Telegram?.WebApp?.initData) {
          throw new Error(
            "Not running in Telegram Mini App or initData not available"
          );
        }

        const initData = Telegram.WebApp.initData;
        return await $fetch("/telegram/miniapp/signin", {
          method: "POST",
          body: { initData },
          ...fetchOptions,
        });
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
      ) => {
        return await $fetch("/sign-in/social", {
          method: "POST",
          body: {
            provider: "telegram-oidc",
            callbackURL: options?.callbackURL,
            errorCallbackURL: options?.errorCallbackURL,
          },
          ...fetchOptions,
        });
      },
    }),
  } satisfies BetterAuthClientPlugin;
};

export default telegramClient;
