/** Provider transport metadata only; bodies, credentials and URL queries are omitted. */
export function observeProviderFetch(
  log: (event: string, data: Record<string, unknown>) => void
) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "oauth.telegram.org") return original(input, init);
    const started = performance.now();
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    try {
      const response = await original(input, init);
      let tokenShape: Record<string, boolean> | undefined;
      if (url.pathname.endsWith("/token")) {
        try {
          const value = await response.clone().json();
          tokenShape = {
            hasIdToken: typeof value.id_token === "string",
            hasError: !!value.error,
          };
        } catch {
          tokenShape = { invalidJSON: true };
        }
      }
      log("provider_http", {
        host: url.hostname,
        path: url.pathname,
        method: init?.method ?? "GET",
        hasAuthorization: headers.has("authorization"),
        status: response.status,
        durationMs: Math.round(performance.now() - started),
        tokenShape,
      });
      return response;
    } catch (error) {
      log("provider_transport_error", {
        host: url.hostname,
        path: url.pathname,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    }
  };
  return () => {
    globalThis.fetch = original;
  };
}
