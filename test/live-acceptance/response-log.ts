import { TELEGRAM_ERROR_CODES } from "../../dist/index.js";

const safeCodes = new Set([
  ...Object.keys(TELEGRAM_ERROR_CODES),
  "not_a_member",
  "telegram_required",
  "unable_to_get_user_info",
  "unable_to_update_account",
  "unable_to_create_user",
  "unable_to_link_account",
  "account_not_linked",
  "internal_server_error",
  "FIELD_NOT_ALLOWED",
  "UNAUTHORIZED",
  "SESSION_NOT_FRESH",
  "FAILED_TO_CREATE_SESSION",
  "FIELD_NOT_ALLOWED",
  "invalid_origin_or_method",
  "unauthorized",
  "request_failed",
  "mode_not_configured",
]);
function errorCode(value: unknown) {
  return typeof value === "string" &&
    /^[A-Za-z0-9_-]{1,80}$/.test(value) &&
    safeCodes.has(value)
    ? value
    : undefined;
}

export async function responseMetadata(response: Response, baseURL: string) {
  const result: { redirectPath?: string; errorCode?: string } = {};
  const location = response.headers.get("location");
  if (location) {
    try {
      const redirect = new URL(location, baseURL);
      result.redirectPath =
        /^\/(trusted|mapper|database|legacy)(\/api\/auth\/(error|callback\/telegram-oidc))?$/.test(
          redirect.pathname
        )
          ? redirect.pathname
          : "other";
      result.errorCode = errorCode(redirect.searchParams.get("error"));
    } catch {
      /* Malformed locations are represented only by HTTP status. */
    }
  }
  if (
    response.status >= 400 &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    try {
      const value = await response.clone().json();
      result.errorCode =
        errorCode(value.code) ?? errorCode(value.error) ?? result.errorCode;
    } catch {
      /* Non-JSON errors must not leak their body into the log. */
    }
  }
  return result;
}
