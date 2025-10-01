import type { BetterAuthClientPlugin } from "better-auth/client";
import type { telegram } from "./index";
import type { TelegramAuthData } from "./types";

type TelegramPlugin = typeof telegram;

/**
 * Telegram Login Widget script URL
 */
const TELEGRAM_WIDGET_SCRIPT = "https://telegram.org/js/telegram-widget.js?22";

/**
 * Options for initializing Telegram Login Widget
 */
export interface TelegramWidgetOptions {
  /**
   * Size of the login button
   * @default "large"
   */
  size?: "large" | "medium" | "small";

  /**
   * Whether to show user photo
   * @default true
   */
  showUserPhoto?: boolean;

  /**
   * Corner radius of the button
   * @default 20
   */
  cornerRadius?: number;

  /**
   * Request write access permission
   * @default false
   */
  requestAccess?: boolean;

  /**
   * Language code (e.g., "en", "pl")
   */
  lang?: string;
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
    script.onerror = () => reject(new Error("Failed to load Telegram widget script"));
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
       */
      signInWithTelegram: async (authData: TelegramAuthData) => {
        const response = await $fetch("/telegram/signin", {
          method: "POST",
          body: authData,
        });

        return response;
      },

      /**
       * Link current user account with Telegram
       * @param authData - Authentication data from Telegram Login Widget
       */
      linkTelegram: async (authData: TelegramAuthData) => {
        const response = await $fetch("/telegram/link", {
          method: "POST",
          body: authData,
        });

        return response;
      },

      /**
       * Unlink Telegram account from current user
       */
      unlinkTelegram: async () => {
        const response = await $fetch("/telegram/unlink", {
          method: "POST",
        });

        return response;
      },

      /**
       * Get Telegram bot configuration
       */
      getTelegramConfig: async () => {
        const response = await $fetch<{ botUsername: string }>("/telegram/config", {
          method: "GET",
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
        const configResponse = await $fetch<{ botUsername: string }>("/telegram/config", {
          method: "GET",
        });

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
        script.setAttribute("data-onauth", callbackName + "(user)");

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
        const configResponse = await $fetch<{ botUsername: string }>("/telegram/config", {
          method: "GET",
        });

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
    }),
  } satisfies BetterAuthClientPlugin;
};

export default telegramClient;
