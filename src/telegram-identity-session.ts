import { createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseUserOutput } from "better-auth/db";
import { currentSignIn } from "./telegram-identity-state";

interface CookieContext {
  context: { responseHeaders?: Headers };
  responseHeaders?: Headers;
}

/** The response headers queued so far, as Better Auth's own cookie helpers see them. */
function pendingHeaders(ctx: CookieContext) {
  return new Set(
    [ctx.responseHeaders, ctx.context.responseHeaders].filter(
      (headers): headers is Headers => headers !== undefined
    )
  );
}

/**
 * Whether the response still sets the session token cookie to `token`; an
 * earlier after hook may have expired it to end the session.
 */
function setsSessionToken(ctx: CookieContext, name: string, token: string) {
  const cookies = [...pendingHeaders(ctx)].flatMap((headers) =>
    headers.getSetCookie()
  );
  const last = cookies.filter((cookie) => cookie.startsWith(`${name}=`)).at(-1);
  if (!last || /;\s*max-age=0(?:;|$)/iu.test(last)) {
    return false;
  }
  const value = last.slice(name.length + 1).split(";")[0] ?? "";
  // A signed cookie: `<token>.<signature>`, URI-encoded.
  return decodeURIComponent(value).startsWith(`${token}.`);
}

/** Drops `Set-Cookie` entries for these cookies (and their chunks) queued so far. */
function dropPendingCookies(ctx: CookieContext, names: string[]) {
  const isNamed = (cookie: string) =>
    names.some(
      (name) => cookie.startsWith(`${name}=`) || cookie.startsWith(`${name}.`)
    );
  for (const headers of pendingHeaders(ctx)) {
    const cookies = headers.getSetCookie();
    if (cookies.some(isNamed)) {
      headers.delete("set-cookie");
      for (const cookie of cookies.filter((entry) => !isNamed(entry))) {
        headers.append("set-cookie", cookie);
      }
    }
  }
}

/**
 * Better Auth issues a session with the user it read before the hooks above
 * ran. When they changed that user, this after hook issues the session
 * cookie (and `newSession`, and the user in an ID token sign-in response)
 * again with the user as stored now, like Better Auth's /update-user;
 * otherwise `session.cookieCache` would serve the old values until it
 * expires, and in stateless mode until the next sign-in.
 */
export const refreshSessionAfterOIDC = {
  matcher: () => true,
  handler: createAuthMiddleware(async (ctx) => {
    const signIn = await currentSignIn();
    const issued = ctx.context.newSession;
    if (!(signIn && issued && signIn.changedUserIds.has(issued.user.id))) {
      return;
    }
    const user = await ctx.context.internalAdapter.findUserById(issued.user.id);
    if (!user) {
      return;
    }
    const { sessionToken, sessionData, dontRememberToken } =
      ctx.context.authCookies;
    if (!setsSessionToken(ctx, sessionToken.name, issued.session.token)) {
      return;
    }
    dropPendingCookies(ctx, [
      sessionToken.name,
      sessionData.name,
      dontRememberToken.name,
    ]);
    await setSessionCookie(ctx, { session: issued.session, user });

    const returned: unknown = ctx.context.returned;
    if (
      returned &&
      typeof returned === "object" &&
      !(returned instanceof Error) &&
      !(returned instanceof Response) &&
      (returned as { user?: { id?: string } }).user?.id === user.id
    ) {
      return ctx.json({
        ...returned,
        user: parseUserOutput(ctx.context.options, user),
      });
    }
  }),
};
