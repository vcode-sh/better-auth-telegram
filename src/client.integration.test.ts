// @vitest-environment node
/**
 * The client plugin through Better Auth's real `createAuthClient`, talking to
 * a real server (`auth.handler`) instead of a mocked `$fetch`: catches wrong
 * paths, methods and body shapes, and fetchOptions spread in the wrong place.
 */
import { createAuthClient } from "better-auth/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TELEGRAM_ERROR_CODES, telegramClient } from "./client";
import {
  BASE_URL,
  createMemoryAuth,
  signInitData,
  signWidgetData,
} from "./testing/harness";

function setup() {
  const { auth, db } = createMemoryAuth(
    {
      miniApp: { enabled: true },
      oidc: {
        enabled: true,
        clientId: "987654321",
        clientSecret: "oidc-client-secret",
      },
    },
    { emailAndPassword: { enabled: true } }
  );
  const jar = new Map<string, string>();
  const requests: Request[] = [];

  const client = createAuthClient({
    baseURL: BASE_URL,
    plugins: [telegramClient()],
    fetchOptions: {
      customFetchImpl: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("origin", BASE_URL);
        if (jar.size) {
          headers.set(
            "cookie",
            [...jar].map(([name, value]) => `${name}=${value}`).join("; ")
          );
        }
        const request = new Request(input, { ...init, headers });
        requests.push(request.clone());
        const response = await auth.handler(request);
        for (const cookie of response.headers.getSetCookie()) {
          const [pair] = cookie.split(";");
          const index = pair!.indexOf("=");
          jar.set(pair!.slice(0, index), pair!.slice(index + 1));
        }
        return response;
      },
    },
  });

  const signUp = () =>
    client.signUp.email({
      email: "ann@example.com",
      password: "correct-horse-battery",
      name: "Ann",
    });

  return { client, db, requests, signUp };
}

type Setup = ReturnType<typeof setup>;
const sessionSubscriptions: (() => void)[] = [];

afterEach(() => {
  for (const unsubscribe of sessionSubscriptions.splice(0)) {
    unsubscribe();
  }
  vi.unstubAllGlobals();
});

describe("client actions against the real server", () => {
  it("linkTelegram and unlinkTelegram change the signed-in user's accounts", async () => {
    const { client, db, signUp } = setup();
    await signUp();

    const link = await client.linkTelegram(
      (await signWidgetData({ id: 42 })) as any
    );
    const linkedProviders = db.account.map((account) => account.providerId);
    const unlink = await client.unlinkTelegram();

    expect(link.error).toBeNull();
    expect(linkedProviders.sort()).toEqual(["credential", "telegram"]);
    expect(unlink.error).toBeNull();
    expect(db.account.map((account) => account.providerId)).toEqual([
      "credential",
    ]);
  });

  it("reports server errors with the codes the client entry exports", async () => {
    const { client } = setup();
    await client.signInWithTelegram((await signWidgetData({ id: 42 })) as any);

    const { error } = await client.unlinkTelegram();

    expect(error?.status).toBe(400);
    expect(error?.code).toBe(
      TELEGRAM_ERROR_CODES.CANNOT_UNLINK_LAST_ACCOUNT.code
    );
    expect(error?.code).toBe("CANNOT_UNLINK_LAST_ACCOUNT");
  });

  it("getTelegramConfig returns the server's bot username", async () => {
    const { client } = setup();

    const { data, error } = await client.getTelegramConfig();

    expect(error).toBeNull();
    expect(data).toEqual({
      botUsername: "test_bot",
      loginWidgetEnabled: true,
      miniAppEnabled: true,
      oidcEnabled: true,
      testMode: false,
    });
  });

  it("validateMiniApp parses valid data without signing the user in", async () => {
    const { client, db } = setup();

    const { data } = await client.validateMiniApp(
      await signInitData({ id: 7 })
    );

    expect(data?.valid).toBe(true);
    expect(data?.data.user.id).toBe(7);
    expect([db.user.length, db.account.length, db.session.length]).toEqual([
      0, 0, 0,
    ]);
  });

  it("signInWithTelegramOIDC forwards both callback URLs to the social-login protocol", async () => {
    const { client, requests } = setup();

    const { data } = await client.signInWithTelegramOIDC({
      callbackURL: "/dashboard",
      errorCallbackURL: "/login",
    });

    expect(await requests[0]!.json()).toEqual({
      provider: "telegram-oidc",
      callbackURL: "/dashboard",
      errorCallbackURL: "/login",
    });
    expect((data as any).redirect).toBe(true);
    expect((data as any).url).toMatch(
      /^https:\/\/oauth\.telegram\.org\/auth\?/u
    );
  });
});

// Better Auth refreshes `useSession` only for its own routes and for plugin
// `atomListeners` (client/config.mjs `matchesSessionSignal`); actions that
// call `$fetch` themselves must notify `$sessionSignal`, as oauth-popup does.
describe("the session store follows Telegram sign-in, link and unlink", () => {
  /**
   * Mounts `useSession` as a component would. Outside a browser the atom
   * skips its first fetch on mount, so load it explicitly.
   */
  async function watchSession(client: Setup["client"]) {
    const unsubscribe = client.useSession.subscribe(() => undefined);
    sessionSubscriptions.push(unsubscribe);
    await client.useSession.get().refetch();
    return {
      telegramId: () => client.useSession.get().data?.user.telegramId ?? null,
    };
  }

  const settles = (assertion: () => void) =>
    vi.waitFor(assertion, { timeout: 2000, interval: 20 });

  it.each<[string, (client: Setup["client"]) => Promise<unknown>]>([
    [
      "signInWithTelegram",
      async (client) =>
        client.signInWithTelegram((await signWidgetData({ id: 42 })) as any),
    ],
    [
      "signInWithMiniApp",
      async (client) =>
        client.signInWithMiniApp(await signInitData({ id: 42 })),
    ],
    [
      "autoSignInFromMiniApp",
      async (client) => {
        vi.stubGlobal("window", {
          Telegram: { WebApp: { initData: await signInitData({ id: 42 }) } },
          location: {
            hash: `#tgWebAppData=${encodeURIComponent(await signInitData({ id: 99 }))}`,
          },
        });
        return client.autoSignInFromMiniApp();
      },
    ],
    [
      "the generated route client.telegram.signin",
      async (client) =>
        (client as any).telegram.signin(await signWidgetData({ id: 42 })),
    ],
  ])("%s signs the session in", async (_action, signIn) => {
    const { client } = setup();
    const session = await watchSession(client);

    const result = (await signIn(client)) as {
      data: { user: { telegramId: string } };
      error: unknown;
    };

    expect(result.error).toBeNull();
    expect(result.data.user.telegramId).toBe("42");
    await settles(() => expect(session.telegramId()).toBe("42"));
  });

  it("disableSignal keeps the mounted session unchanged until an explicit refresh", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { client, requests } = setup();
      const session = await watchSession(client);
      const requestCount = requests.length;

      const response = await client.signInWithTelegram(
        (await signWidgetData({ id: 42 })) as any,
        { disableSignal: true }
      );
      // Better Auth schedules signal-driven refreshes after the action resolves.
      await vi.runOnlyPendingTimersAsync();

      expect(response.error).toBeNull();
      expect(response.data?.user.telegramId).toBe("42");
      expect(
        requests
          .slice(requestCount)
          .map((request) => new URL(request.url).pathname)
      ).toEqual(["/api/auth/telegram/signin"]);
      expect(session.telegramId()).toBeNull();
      await client.useSession.get().refetch();
      expect(session.telegramId()).toBe("42");
    } finally {
      for (const unsubscribe of sessionSubscriptions.splice(0)) {
        unsubscribe();
      }
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it("a rejected sign-in returns the error without refreshing or changing the session", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { client, requests, db } = setup();
      const session = await watchSession(client);
      const requestCount = requests.length;

      const response = await client.signInWithTelegram({ id: 42 } as any);
      await vi.runOnlyPendingTimersAsync();

      expect(response.data).toBeNull();
      expect(response.error?.code).toBe("INVALID_AUTH_DATA");
      expect(
        requests
          .slice(requestCount)
          .map((request) => new URL(request.url).pathname)
      ).toEqual(["/api/auth/telegram/signin"]);
      expect(session.telegramId()).toBeNull();
      expect([db.user.length, db.account.length, db.session.length]).toEqual([
        0, 0, 0,
      ]);
    } finally {
      for (const unsubscribe of sessionSubscriptions.splice(0)) {
        unsubscribe();
      }
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it("linkTelegram and unlinkTelegram update session.user", async () => {
    const { client, signUp } = setup();
    const session = await watchSession(client);
    await signUp();
    // Sign-up refreshes the store itself; let that refresh land first.
    await settles(() =>
      expect(client.useSession.get().data?.user.email).toBe("ann@example.com")
    );

    await client.linkTelegram((await signWidgetData({ id: 42 })) as any);
    await settles(() => expect(session.telegramId()).toBe("42"));
    await client.unlinkTelegram();
    await settles(() => expect(session.telegramId()).toBeNull());
  });
});

describe("fetchOptions reach the request", () => {
  const fetchOptions = { headers: { "x-probe": "1" } };

  it.each<[string, (setup: Setup) => Promise<unknown>]>([
    [
      "signInWithTelegram",
      async ({ client }) =>
        client.signInWithTelegram(
          (await signWidgetData({ id: 42 })) as any,
          fetchOptions
        ),
    ],
    [
      "linkTelegram",
      async ({ client }) =>
        client.linkTelegram(
          (await signWidgetData({ id: 42 })) as any,
          fetchOptions
        ),
    ],
    ["unlinkTelegram", ({ client }) => client.unlinkTelegram(fetchOptions)],
    [
      "getTelegramConfig",
      ({ client }) => client.getTelegramConfig(fetchOptions),
    ],
    [
      "signInWithMiniApp",
      async ({ client }) =>
        client.signInWithMiniApp(await signInitData({ id: 7 }), fetchOptions),
    ],
    [
      "validateMiniApp",
      async ({ client }) =>
        client.validateMiniApp(await signInitData({ id: 7 }), fetchOptions),
    ],
    [
      "autoSignInFromMiniApp",
      async ({ client }) => {
        vi.stubGlobal("window", {
          Telegram: { WebApp: { initData: await signInitData({ id: 7 }) } },
          location: { hash: "" },
        });
        return client.autoSignInFromMiniApp(fetchOptions);
      },
    ],
    [
      "signInWithTelegramOIDC",
      ({ client }) => client.signInWithTelegramOIDC({}, fetchOptions),
    ],
  ])("%s", async (_action, call) => {
    const context = setup();

    await call(context);

    expect(context.requests.at(-1)!.headers.get("x-probe")).toBe("1");
  });
});
