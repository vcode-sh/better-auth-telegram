// @vitest-environment node
/**
 * The client plugin through Better Auth's real `createAuthClient`, talking to
 * a real server (`auth.handler`) instead of a mocked `$fetch`: catches wrong
 * paths, methods and body shapes, and fetchOptions spread in the wrong place.
 */
import { createAuthClient } from "better-auth/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { telegramClient } from "./client";
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client actions against the real server", () => {
  it("signInWithTelegram signs the Telegram user in", async () => {
    const { client } = setup();

    const { data, error } = await client.signInWithTelegram(
      (await signWidgetData({ id: 42 })) as any
    );

    expect(error).toBeNull();
    expect((data as any).user.telegramId).toBe("42");
  });

  it("signInWithTelegram surfaces the server's 400 for an unsigned payload", async () => {
    const { client } = setup();

    const { data, error } = await client.signInWithTelegram({ id: 42 } as any);

    expect(data).toBeNull();
    expect(error?.status).toBe(400);
  });

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

  it("getTelegramConfig returns the server's bot username", async () => {
    const { client } = setup();

    const { data } = await client.getTelegramConfig();

    expect(data?.botUsername).toBe("test_bot");
  });

  it("signInWithMiniApp signs the Mini App user in", async () => {
    const { client } = setup();

    const { data } = await client.signInWithMiniApp(
      await signInitData({ id: 7 })
    );

    expect((data as any).user.telegramId).toBe("7");
  });

  it("validateMiniApp reports valid initData with the parsed user", async () => {
    const { client } = setup();

    const { data } = await client.validateMiniApp(
      await signInitData({ id: 7 })
    );

    expect(data?.valid).toBe(true);
    expect(data?.data.user.id).toBe(7);
  });

  it("autoSignInFromMiniApp signs in with Telegram.WebApp.initData", async () => {
    const { client } = setup();
    vi.stubGlobal("window", {
      Telegram: { WebApp: { initData: await signInitData({ id: 7 }) } },
      location: { hash: "" },
    });

    const { data } = await client.autoSignInFromMiniApp();

    expect((data as any).user.telegramId).toBe("7");
  });

  it("signInWithTelegramOIDC returns Telegram's authorization URL to redirect to", async () => {
    const { client } = setup();

    const { data } = await client.signInWithTelegramOIDC({
      callbackURL: "/dashboard",
    });

    expect((data as any).redirect).toBe(true);
    expect((data as any).url).toMatch(
      /^https:\/\/oauth\.telegram\.org\/auth\?/u
    );
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
