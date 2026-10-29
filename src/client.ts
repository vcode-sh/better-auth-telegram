import type {
  BetterAuthClientPlugin,
  BetterFetch,
  ClientStore,
} from "better-auth/client";
import type { Session, User } from "better-auth/types";
import { TELEGRAM_ERROR_CODES } from "./error-codes";
import type { telegram } from "./index";
import type { TelegramAuthData } from "./types";

// biome-ignore lint/performance/noBarrelFile: the client entry's runtime error map
export { TELEGRAM_ERROR_CODES } from "./error-codes";

type TelegramPlugin = typeof telegram;

/**
 * Options that can be passed to fetch calls for customization
 * (e.g., custom headers, cache control, credentials)
 */
type FetchOptions = Record<string, any>;

/**
 * `error` of every action: Better Auth's error body. `code` is one of
 * `TELEGRAM_ERROR_CODES` or a Better Auth code (`SESSION_NOT_FRESH`, ...).
 */
export interface TelegramClientError {
  code?: string;
  message?: string;
}

/** The user as the Telegram endpoints return it. */
export type TelegramUser = User & {
  telegramId?: string | null;
  telegramPhoneNumber?: string | null;
  telegramUsername?: string | null;
};

/** Response of `/telegram/signin` and `/telegram/miniapp/signin`. */
export interface TelegramSignInResponse {
  session: Session;
  user: TelegramUser;
}

/** Response of `/telegram/link` and `/telegram/unlink`. */
export interface TelegramLinkResponse {
  message: string;
  success: boolean;
}

interface TelegramConfigResponse {
  botUsername: string;
  loginWidgetEnabled: boolean;
  miniAppEnabled: boolean;
  oidcEnabled: boolean;
  testMode: boolean;
}

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
  // Check if script already loaded
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
    widgetScriptLoading = undefined;
  });
  return widgetScriptLoading;
}

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

function getMiniAppInitData(): string | undefined {
  const sdkInitData = (window as any).Telegram?.WebApp?.initData;
  if (sdkInitData) {
    return sdkInitData;
  }

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
): Promise<TelegramWidget> {
  await loadTelegramWidgetScript();

  const configResponse = await $fetch<TelegramConfigResponse>(
    "/telegram/config",
    { method: "GET" }
  );
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

  const element = resolveContainer(container);
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
          (window as any)[callbackName] = async (
            authData: TelegramAuthData
          ) => {
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
          await renderWidget($fetch, container, options, {
            "data-auth-url": redirectUrl,
          }),

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
