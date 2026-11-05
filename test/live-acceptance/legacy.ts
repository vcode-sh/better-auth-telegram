import type { DatabaseSync } from "node:sqlite";
import type { BetterAuthOptions } from "better-auth";
import { telegram } from "../../dist/index.js";

export function legacyOptions(
  baseURL: string,
  secret: string,
  database: DatabaseSync,
  credentials: { legacyBotToken?: string; legacyBotUsername?: string },
  log: (event: string, data?: Record<string, unknown>) => void
): BetterAuthOptions {
  return {
    baseURL,
    basePath: "/legacy/api/auth",
    secret,
    database,
    trustedOrigins: [baseURL],
    advanced: { cookiePrefix: "bat_live_legacy" },
    logger: {
      log(level) {
        log("auth_diagnostic", { mode: "legacy", level });
      },
    },
    session: {
      expiresIn: 300,
      cookieCache: {
        enabled: true,
        strategy: "jwt",
        maxAge: 300,
        refreshCache: false,
      },
    },
    account: { accountLinking: { allowUnlinkingAll: true } },
    plugins: [
      telegram({
        botToken: credentials.legacyBotToken,
        botUsername: credentials.legacyBotUsername,
        miniApp: { enabled: true },
      }),
    ],
    databaseHooks: {
      account: {
        create: {
          async after(account) {
            log("account_created", {
              mode: "legacy",
              providerId: account.providerId,
            });
          },
        },
      },
      session: {
        create: {
          async after() {
            log("session_created", { mode: "legacy" });
          },
        },
      },
    },
  };
}

export async function revokeOwnSession(
  request: Request,
  auth: any,
  baseURL: string,
  log: (event: string, data: Record<string, unknown>) => void
) {
  if (request.method !== "POST" || request.headers.get("origin") !== baseURL) {
    return Response.json(
      { error: "invalid_origin_or_method" },
      { status: 403 }
    );
  }
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  await (await auth.$context).internalAdapter.deleteSession(
    session.session.token
  );
  log("own_session_revoked", { mode: "legacy", cookieCachePreserved: true });
  return Response.json({ revoked: true, cookieCachePreserved: true });
}
