import type { BetterFetch } from "better-auth/client";
import type { TelegramConfigResponse } from "./client-types";
import type { TelegramAuthData } from "./types";

/**
 * Telegram Login Widget script URL
 */
const TELEGRAM_WIDGET_SCRIPT = "https://telegram.org/js/telegram-widget.js?24";

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

/** The widget script load in flight, shared by widgets initialized meanwhile. */
let widgetScriptLoading: Promise<void> | undefined;

/**
 * Helper to load Telegram Widget script
 */
function loadTelegramWidgetScript(): Promise<void> {
  if ((window as any).Telegram?.Login) {
    return Promise.resolve();
  }

  widgetScriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TELEGRAM_WIDGET_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Telegram widget script"));
    document.head.appendChild(script);
  }).finally(() => {
    // Share concurrent loads, but let a later attempt retry after a failure.
    widgetScriptLoading = undefined;
  });
  return widgetScriptLoading;
}

// A late response must not replace a newer initialization of the same host.
const pendingRenders = new WeakMap<HTMLElement, symbol>();

let widgetCount = 0;

/** A global name for a widget's `data-onauth` callback that no widget uses yet. */
function nextCallbackName(): string {
  let name: string;
  do {
    widgetCount += 1;
    name = `telegramCallback_${widgetCount}`;
  } while (name in window);
  return name;
}

function requireBotUsername(botUsername: string | undefined): string {
  if (!botUsername) {
    throw new Error("Telegram plugin: botUsername is required");
  }

  return botUsername;
}

/** A rendered Login Widget. */
export interface TelegramWidget {
  /**
   * Removes the widget: its script, the iframe Telegram rendered for it and
   * (for `initTelegramWidget`) its global callback. Call it from an effect
   * cleanup. A widget rendered later into the same container is unaffected.
   */
  destroy: () => void;
}

function resolveContainer(container: string | HTMLElement): HTMLElement {
  if (typeof container !== "string") {
    return container;
  }
  const element = document.getElementById(container);
  if (!element) {
    throw new Error(`Container with id "${container}" not found`);
  }
  return element;
}

/**
 * Loads Telegram's widget script, fetches the bot username and renders the
 * widget into `container` (replacing its content).
 */
async function renderWidget(
  $fetch: BetterFetch,
  container: string | HTMLElement,
  options: TelegramWidgetOptions,
  loginAttributes: Record<string, string>
): Promise<TelegramWidget | null> {
  const element = resolveContainer(container);
  const request = Symbol("widget initialization");
  pendingRenders.set(element, request);
  await loadTelegramWidgetScript();

  const configResponse = await $fetch<TelegramConfigResponse>(
    "/telegram/config",
    { method: "GET" }
  );
  if (pendingRenders.get(element) !== request) {
    return null;
  }
  if (!configResponse.data) {
    throw new Error("Failed to get Telegram config");
  }
  const botUsername = requireBotUsername(configResponse.data.botUsername);
  const {
    size = "large",
    showUserPhoto = true,
    cornerRadius = 20,
    requestAccess = false,
    lang,
  } = options;

  element.innerHTML = "";

  const script = document.createElement("script");
  script.src = TELEGRAM_WIDGET_SCRIPT;
  script.async = true;
  script.setAttribute("data-telegram-login", botUsername);
  script.setAttribute("data-size", size);
  script.setAttribute("data-userpic", showUserPhoto.toString());
  script.setAttribute("data-radius", cornerRadius.toString());
  for (const [name, value] of Object.entries(loginAttributes)) {
    script.setAttribute(name, value);
  }
  if (requestAccess) {
    script.setAttribute("data-request-access", "write");
  }
  if (lang) {
    script.setAttribute("data-lang", lang);
  }
  element.appendChild(script);

  return {
    destroy: () => {
      // telegram-widget.js keeps the iframe it inserts on the script.
      (script as HTMLScriptElement & { _iframe?: Element })._iframe?.remove();
      script.remove();
    },
  };
}

/** Widget actions share one renderer so callback and redirect modes stay consistent. */
export function createTelegramWidgetActions($fetch: BetterFetch) {
  return {
    /**
     * Initialize Telegram Login Widget
     * This function creates a Telegram login button and handles the authentication flow
     *
     * @param container - The element to render into, or its id
     * @param options - Widget configuration options
     * @param onAuth - Callback function called when user successfully authenticates
     * @returns The widget; `destroy()` removes it (effect cleanup)
     *
     * @example
     * ```ts
     * const widget = await initTelegramWidget("telegram-login-container", {
     *   size: "large",
     *   showUserPhoto: true
     * }, async (authData) => {
     *   const result = await signInWithTelegram(authData);
     *   console.log("Signed in:", result);
     * });
     * // later: widget.destroy();
     * ```
     */
    initTelegramWidget: async (
      container: string | HTMLElement,
      options: TelegramWidgetOptions = {},
      onAuth: (authData: TelegramAuthData) => void | Promise<void>
    ): Promise<TelegramWidget> => {
      // A global per widget, kept until destroy(): the user can log in
      // again without a reload.
      const callbackName = nextCallbackName();
      const widget = await renderWidget($fetch, container, options, {
        "data-onauth": `${callbackName}(user)`,
      });
      if (!widget) {
        return { destroy: () => {} };
      }
      (window as any)[callbackName] = async (authData: TelegramAuthData) => {
        try {
          await onAuth(authData);
        } catch (error) {
          console.error(
            "[better-auth-telegram] Telegram widget onAuth failed:",
            error
          );
        }
      };
      return {
        destroy: () => {
          widget.destroy();
          delete (window as any)[callbackName];
        },
      };
    },

    /**
     * Alternative method: Use Telegram Login with redirect
     *
     * @param container - The element to render into, or its id
     * @param redirectUrl - URL to redirect after successful authentication
     * @param options - Widget configuration options
     * @returns The widget; `destroy()` removes it
     *
     * @example
     * ```ts
     * await initTelegramWidgetRedirect(
     *   "telegram-login",
     *   "/auth/telegram/callback",
     *   { size: "medium" }
     * );
     * ```
     */
    initTelegramWidgetRedirect: async (
      container: string | HTMLElement,
      redirectUrl: string,
      options: TelegramWidgetOptions = {}
    ): Promise<TelegramWidget> =>
      (await renderWidget($fetch, container, options, {
        "data-auth-url": redirectUrl,
      })) ?? { destroy: () => {} },
  };
}
