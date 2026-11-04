import type { Session, User } from "better-auth/types";

/**
 * Options that can be passed to fetch calls for customization
 * (e.g., custom headers, cache control, credentials)
 */
export type FetchOptions = Record<string, any>;

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

export interface TelegramConfigResponse {
  botUsername: string;
  loginWidgetEnabled: boolean;
  miniAppEnabled: boolean;
  oidcEnabled: boolean;
  testMode: boolean;
}
