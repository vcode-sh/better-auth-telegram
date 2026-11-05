import { readFileSync } from "node:fs";
import { decodeJwt } from "jose";
import { createModes, modes, type Credentials } from "./auth";
import { createLog, safeSession, safeUser } from "./log";
import { page } from "./ui";
import { observeProviderFetch } from "./network";
import { revokeOwnSession } from "./legacy";
import { responseMetadata } from "./response-log";

const baseURL = process.env.BAT_LIVE_BASE_URL;
const credentialsPath = process.env.BAT_LIVE_CREDENTIALS_FILE;
const logPath = process.env.BAT_LIVE_LOG_FILE;
if (!baseURL || !credentialsPath || !logPath)
  throw new Error(
    "Set BAT_LIVE_BASE_URL, BAT_LIVE_CREDENTIALS_FILE and BAT_LIVE_LOG_FILE"
  );
const credentials: Credentials = JSON.parse(
  readFileSync(credentialsPath, "utf8")
);
if (!credentials.oidcClientId || !credentials.oidcClientSecret)
  throw new Error("OIDC credentials are missing");
const log = createLog(logPath);
const restoreFetch = observeProviderFetch(log);
const { instances, close } = await createModes(baseURL, credentials, log);
const bundle = await Bun.build({
  entrypoints: [new URL("./browser.ts", import.meta.url).pathname],
  target: "browser",
  minify: false,
});
if (!bundle.success) throw new Error("Client bundle failed");
const clientJS = await bundle.outputs[0]!.text();

function jwtEvidence(request: Request, cookieName: string) {
  const cookies = request.headers.get("cookie")?.split(/;\s*/) ?? [];
  const cookie = cookies.find((part) => part.split("=")[0] === cookieName);
  if (!cookie) return null;
  try {
    const payload = decodeJwt(
      decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1))
    );
    return {
      user: safeUser(payload.user as Record<string, unknown>),
      session: safeSession(payload.session as Record<string, unknown>),
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return { decodeFailed: true };
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.BAT_LIVE_PORT ?? 3417),
  async fetch(request) {
    const started = performance.now();
    const url = new URL(request.url);
    const mode = modes.find(
      (name) =>
        url.pathname === `/${name}` || url.pathname.startsWith(`/${name}/`)
    );
    let response: Response;
    try {
      if (mode && !instances.has(mode)) {
        response = Response.json(
          { error: "mode_not_configured" },
          { status: 503 }
        );
      } else if (mode === "legacy" && url.pathname === "/legacy/revoke") {
        response = await revokeOwnSession(
          request,
          instances.get(mode)!,
          baseURL,
          log
        );
      } else if (url.pathname === "/assets/browser.js") {
        response = new Response(clientJS, {
          headers: { "content-type": "text/javascript" },
        });
      } else if (mode && url.pathname.startsWith(`/${mode}/api/auth/`)) {
        response = await instances.get(mode)!.handler(request);
      } else if (mode && url.pathname === `/${mode}/evidence`) {
        const session = await instances
          .get(mode)!
          .api.getSession({ headers: request.headers });
        const evidence = {
          mode,
          authenticated: !!session,
          user: safeUser(session?.user),
          session: safeSession(session?.session),
          jwt: session
            ? jwtEvidence(
                request,
                (await instances.get(mode)!.$context).authCookies.sessionData
                  .name
              )
            : null,
        };
        log("session_read", evidence);
        response = Response.json(evidence);
      } else if (url.pathname === "/health") {
        response = Response.json({ ok: true, modes: [...instances.keys()] });
      } else if (
        url.pathname === "/" ||
        (mode && url.pathname === `/${mode}`)
      ) {
        response = new Response(page(mode), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      } else response = new Response("Not found", { status: 404 });
    } catch (error) {
      log("request_error", {
        mode,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      response = Response.json({ error: "request_failed" }, { status: 500 });
    }
    log("http_response", {
      mode,
      method: request.method,
      path: url.pathname,
      status: response.status,
      queryKeys: [...new Set(url.searchParams.keys())].sort(),
      durationMs: Math.round(performance.now() - started),
      setsCookie: response.headers.has("set-cookie"),
      ...(await responseMetadata(response, baseURL)),
    });
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  },
});
log("server_started", { modes, baseURL, port: server.port });
console.log(
  `Live acceptance listening on 127.0.0.1:${server.port}; structured events at configured private log path.`
);
function shutdown() {
  server.stop(true);
  close();
  restoreFetch();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
