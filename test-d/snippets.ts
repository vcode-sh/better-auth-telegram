// Documented snippets, compiled against dist/ by `npm run test:types`.
// Each block mirrors a code sample in README.md or docs/*.md (named in the
// comment above it). When you change a sample in the docs, change it here.
// JSX can't be compiled here (no React types), so React samples are checked
// through their effect bodies with minimal hook stubs.
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { createAuthClient } from "better-auth/client";
import { toNextJsHandler } from "better-auth/next-js";
import { type TelegramAuthData, telegram } from "better-auth-telegram";
import {
  TELEGRAM_ERROR_CODES,
  telegramClient,
} from "better-auth-telegram/client";

// README "Set up the server", docs/installation.md "Configure the server"
const auth = betterAuth({
  database: new DatabaseSync("./sqlite.db"),
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
    }),
  ],
});

// README "Connect Better Auth to your framework" (app/api/auth/[...all]/route.ts)
export const { GET, POST } = toNextJsHandler(auth);

// README "Set up the client", docs/installation.md, docs/usage.md
const authClient = createAuthClient({
  plugins: [telegramClient()],
});

// README "Show the Telegram button", docs/usage.md "Show the widget"
export async function showTelegramLogin() {
  const widget = await authClient.initTelegramWidget(
    "telegram-login",
    { size: "large" },
    async (telegramData) => {
      const { error } = await authClient.signInWithTelegram(telegramData);
      if (error) {
        console.error("Telegram sign-in failed:", error.message);
        return;
      }
      window.location.href = "/dashboard";
    }
  );
  return widget;
}

// README "The other sign-in methods"
export const readmeMiniApp = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  miniApp: { enabled: true },
});
export async function readmeAutoSignIn() {
  const { data, error } = await authClient.autoSignInFromMiniApp();
  return { data, error };
}
export const readmeOidc = telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
  },
});
export async function readmeOidcSignIn() {
  await authClient.signInWithTelegramOIDC({ callbackURL: "/dashboard" });
}

// docs/usage.md "React component": the effect body, with hook stubs
declare function useRef<T>(initial: T | null): { current: T | null };
declare function useState<T>(initial: T): [T, (value: T) => void];
declare function useEffect(
  effect: () => undefined | (() => void),
  deps: unknown[]
): void;
export function telegramLoginButtonEffect() {
  const container = useRef<HTMLDivElement>(null);
  const [, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!container.current) {
      return;
    }
    const host = document.createElement("div");
    container.current.appendChild(host);
    const widget = authClient.initTelegramWidget(
      host,
      { size: "large" },
      async (telegramData) => {
        const result = await authClient.signInWithTelegram(telegramData);
        if (result.error) {
          setError(result.error.message ?? "Sign-in failed");
          return;
        }
        window.location.href = "/dashboard";
      }
    );
    widget.catch(() => {
      if (host.isConnected) {
        setError("Could not load the Telegram button");
      }
    });
    return () => {
      host.remove();
      widget.then((w) => w.destroy()).catch(() => undefined);
    };
  }, []);
}

// docs/usage.md "Redirect mode"
export async function showTelegramLoginRedirect() {
  return await authClient.initTelegramWidgetRedirect(
    "telegram-login",
    `${window.location.origin}/auth/telegram/callback`,
    { size: "large" }
  );
}
function readTelegramRedirect(search: string): TelegramAuthData | null {
  const params = new URLSearchParams(search);
  const id = params.get("id");
  const firstName = params.get("first_name");
  const authDate = params.get("auth_date");
  const hash = params.get("hash");
  if (!(id && firstName && authDate && hash)) {
    return null;
  }
  return {
    id: Number(id),
    first_name: firstName,
    auth_date: Number(authDate),
    hash,
    last_name: params.get("last_name") ?? undefined,
    username: params.get("username") ?? undefined,
    photo_url: params.get("photo_url") ?? undefined,
  };
}
export async function finishTelegramRedirect() {
  const telegramData = readTelegramRedirect(window.location.search);
  if (!telegramData) {
    return "Telegram did not send any sign-in data.";
  }
  const { error } = await authClient.signInWithTelegram(telegramData);
  if (error) {
    return error.message ?? "Sign-in failed";
  }
  window.location.href = "/dashboard";
  return null;
}

// docs/usage.md "After sign-in: the session"
export async function signIn(telegramData: TelegramAuthData) {
  const { data, error } = await authClient.signInWithTelegram(telegramData);
  if (error) {
    return null;
  }
  // data.user.telegramId: string | null | undefined
  return data.user satisfies { telegramId?: string | null };
}
export async function currentTelegramId(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  return session?.user.telegramId ?? null;
}

// docs/usage.md "Link Telegram to a signed-in user"
export async function showLinkTelegramButton() {
  return await authClient.initTelegramWidget(
    "telegram-link",
    { size: "medium" },
    async (telegramData) => {
      const { error } = await authClient.linkTelegram(telegramData);
      if (error) {
        console.error("Could not link Telegram:", error.message);
        return;
      }
      console.log("Telegram is now linked to your account.");
    }
  );
}

// docs/usage.md "Unlink Telegram"
export async function unlinkTelegram() {
  const { error } = await authClient.unlinkTelegram();
  if (error?.code === "CANNOT_UNLINK_LAST_ACCOUNT") {
    return "Add another way to sign in (for example a password) before removing Telegram.";
  }
  if (error?.code === "SESSION_NOT_FRESH") {
    return "For your security, please sign in again, then try once more.";
  }
  if (error) {
    return error.message ?? "Could not unlink Telegram.";
  }
  return "Telegram has been removed from your account.";
}

// docs/usage.md "Handle errors"
export async function unlinkWithCodes() {
  const { error } = await authClient.unlinkTelegram();
  if (error?.code === TELEGRAM_ERROR_CODES.CANNOT_UNLINK_LAST_ACCOUNT.code) {
    // ask the user to add another sign-in method first
  }
}

// docs/usage.md "Fetch options"
export async function signInWithHeader(telegramData: TelegramAuthData) {
  return await authClient.signInWithTelegram(telegramData, {
    headers: { "x-request-source": "landing-page" },
  });
}
export async function signInWithoutSessionRefresh(
  telegramData: TelegramAuthData
) {
  return await authClient.signInWithTelegram(telegramData, {
    disableSignal: true,
  });
}

// docs/oidc.md "Configure the server" (OIDC together with the Login Widget)
export const oidcWithWidget = betterAuth({
  database: new DatabaseSync("./sqlite.db"),
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
      oidc: {
        enabled: true,
        clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
        clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
      },
    }),
  ],
});

// docs/oidc.md "Add the sign-in button"
export async function signInWithTelegramOIDC() {
  const { error } = await authClient.signInWithTelegramOIDC({
    callbackURL: "/dashboard",
    errorCallbackURL: "/login",
  });
  if (error) {
    console.error("Could not start Telegram sign-in:", error.message);
  }
}
export async function signInWithTelegramWelcome() {
  await authClient.signIn.social({
    provider: "telegram-oidc",
    callbackURL: "/dashboard",
    newUserCallbackURL: "/welcome",
  });
}

// docs/oidc.md "What gets stored" (mapper)
export const oidcMapper = telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
    mapOIDCProfileToUser: (claims) => ({
      name: claims.preferred_username ?? claims.name,
    }),
  },
});

// docs/oidc.md "Phone numbers"
export const oidcPhone = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  loginWidget: false,
  miniApp: { enabled: true },
  oidc: {
    enabled: true,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
    requestPhone: true,
  },
});

// docs/oidc.md "Link Telegram OIDC to a signed-in user"
export async function linkTelegramOIDC() {
  await authClient.linkSocial({
    provider: "telegram-oidc",
    callbackURL: "/settings",
  });
}
export const oidcLinking = betterAuth({
  account: {
    accountLinking: {
      trustedProviders: ["telegram-oidc"],
      allowDifferentEmails: true,
    },
  },
  plugins: [
    telegram({
      loginWidget: false,
      oidc: {
        enabled: true,
        clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
        clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
      },
    }),
  ],
});

// docs/oidc.md "Sign in with an ID token you already have", migration step 8
export async function signInWithIdToken(token: string, nonce: string) {
  return await authClient.signIn.social({
    provider: "telegram-oidc",
    idToken: { token, nonce },
  });
}

// docs/miniapps.md "Configure the server"
export const miniAppAuth = betterAuth({
  database: new DatabaseSync("./sqlite.db"),
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      loginWidget: false,
      miniApp: { enabled: true },
    }),
  ],
});

// docs/miniapps.md "Sign the user in"
export async function signInInsideTelegram() {
  try {
    const { data, error } = await authClient.autoSignInFromMiniApp();
    if (error) {
      return `Sign-in failed: ${error.message}`;
    }
    return `Welcome, ${data.user.name}!`;
  } catch {
    return "Please open this app from Telegram.";
  }
}

// docs/miniapps.md "Sign the user in" (manual)
declare global {
  interface Window {
    Telegram?: { WebApp: { initData: string; ready: () => void } };
  }
}
export async function signInManually() {
  const initData = window.Telegram?.WebApp.initData;
  if (!initData) {
    return null;
  }
  window.Telegram?.WebApp.ready();
  return await authClient.signInWithMiniApp(initData);
}

// docs/miniapps.md "Validate initData without signing in"
export async function checkInitData(initData: string) {
  const { data } = await authClient.validateMiniApp(initData);
  if (data?.valid) {
    return data.data;
  }
  return null;
}

// docs/miniapps.md "Inside Telegram Web: cookies in an iframe"
export const iframeCookies = betterAuth({
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      partitioned: true,
    },
  },
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      miniApp: { enabled: true },
    }),
  ],
});

// docs/miniapps.md, docs/troubleshooting.md "403 INVALID_ORIGIN"
export const withTrustedOrigins = betterAuth({
  trustedOrigins: ["https://app.example.com"],
});

// docs/troubleshooting.md "400 CANNOT_UNLINK_LAST_ACCOUNT"
export const allowUnlinkingAll = betterAuth({
  account: {
    accountLinking: { allowUnlinkingAll: true },
  },
});

// docs/troubleshooting.md "Telegram fields in the session are out of date"
export async function freshSession() {
  return await authClient.getSession({ query: { disableCookieCache: true } });
}

// docs/configuration.md "Starting points"
export const loginWidgetOnly = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
});
export const miniAppOnly = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  loginWidget: false,
  miniApp: { enabled: true },
});
export const everything = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  miniApp: { enabled: true },
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
  },
});
export const inviteOnly = telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  autoCreateUser: false,
  allowUserToLink: false,
  maxAuthAge: 3600,
});

// docs/configuration.md "Custom user data"
export const withMappers = betterAuth({
  user: {
    additionalFields: {
      language: { type: "string", required: false },
    },
  },
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
      mapTelegramDataToUser: (data) => ({
        name: data.username ?? data.first_name,
      }),
      miniApp: {
        enabled: true,
        mapMiniAppDataToUser: (user) => ({
          language: user.language_code,
        }),
      },
    }),
  ],
});

// docs/migration-v2-to-v3.md step 5: the id claim is a string
export const idClaimIsString = telegram({
  oidc: {
    enabled: true,
    mapOIDCProfileToUser: (claims) => {
      const telegramId: string | undefined = claims.id;
      return { name: telegramId ? claims.name : undefined };
    },
  },
});

// docs/migration-v2-to-v3.md step 10
export const validateUserInfoExample = betterAuth({
  user: {
    validateUserInfo: ({ user, source }) => {
      const isTelegram =
        source.method === "telegram-login-widget" ||
        source.method === "telegram-mini-app";
      if (!(isTelegram || String(user.email ?? "").endsWith("@example.com"))) {
        return { error: "email_domain_not_allowed" };
      }
    },
  },
});

// docs/migration-v2-to-v3.md step 12
export async function unlinkTelegramV3(showError: (message: string) => void) {
  const { error } = await authClient.unlinkTelegram();
  if (error?.code === "CANNOT_UNLINK_LAST_ACCOUNT") {
    showError("Add another way to sign in before removing Telegram.");
  } else if (error?.code === "SESSION_NOT_FRESH") {
    showError("Please sign in again, then remove Telegram.");
  } else if (error) {
    showError(error.message ?? "Could not remove Telegram.");
  }
}
