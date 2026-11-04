import { BASE_URL } from "./constants";

const AUTH_BASE = `${BASE_URL}/api/auth`;

interface Auth {
  handler: (request: Request) => Promise<Response>;
}

/** Minimal cookie-carrying HTTP client for `auth.handler`. */
export function createClient(auth: Auth) {
  const jar = new Map<string, string>();

  const storeCookies = (response: Response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index);
      const value = pair!.slice(index + 1);
      if (value === "" || /max-age=0/iu.test(cookie)) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }
  };

  const cookieHeader = () =>
    [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

  async function request(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ) {
    const url = path.startsWith("http") ? path : `${AUTH_BASE}${path}`;
    const response = await auth.handler(
      new Request(url, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: {
          origin: BASE_URL,
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(jar.size ? { cookie: cookieHeader() } : {}),
          ...init.headers,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
    );
    storeCookies(response);
    const text = await response.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, headers: response.headers, json, text };
  }

  return {
    request,
    post: (path: string, body: unknown) => request(path, { body }),
    get: (path: string) => request(path),
    clearCookies: () => jar.clear(),
    hasSession: () =>
      [...jar.keys()].some((name) => name.includes("session_token")),
  };
}

export type TestClient = ReturnType<typeof createClient>;
