import type { GenericEndpointContext } from "@better-auth/core";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import type { Session, User } from "better-auth";
import { APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseSessionOutput, parseUserOutput } from "better-auth/db";
import type { TelegramUser } from "./telegram-account-state";

/**
 * Creates a session for `user`, sets the session cookie and answers with
 * both, filtered like Better Auth's own sign-in responses (no
 * `returned: false` fields).
 */
export async function startSession(
  ctx: GenericEndpointContext,
  user: TelegramUser
) {
  const session = await ctx.context.internalAdapter.createSession(user.id);
  if (!session) {
    // A database hook vetoed it; Better Auth's /sign-in/email answers the same.
    throw APIError.from(
      "UNAUTHORIZED",
      BASE_ERROR_CODES.FAILED_TO_CREATE_SESSION
    );
  }
  await setSessionCookie(ctx, { session, user });
  return ctx.json({
    user: parseUserOutput(ctx.context.options, user),
    session: parseSessionOutput(ctx.context.options, session),
  });
}

/**
 * Re-issues the session cookie with the user as stored now, like Better
 * Auth's /update-user, so `session.cookieCache` doesn't keep serving the
 * Telegram identity from before a link or unlink.
 */
export async function refreshSessionCookie(
  ctx: GenericEndpointContext,
  session: { session: Session; user: User }
) {
  const user = await ctx.context.internalAdapter.findUserById(session.user.id);
  if (user) {
    await setSessionCookie(ctx, { session: session.session, user });
  }
}
