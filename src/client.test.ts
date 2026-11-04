/**
 * @vitest-environment happy-dom
 *
 * Browser-side behavior of the client plugin: the Telegram widget embed and
 * Mini App initData discovery. Server round trips are covered against a real
 * Better Auth instance in client.integration.test.ts; here `$fetch` only
 * supplies the bot configuration the widget needs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TelegramWidget, telegramClient } from "./client";
import type { TelegramAuthData } from "./types";

const WIDGET_SCRIPT = "https://telegram.org/js/telegram-widget.js?24";

const ann: TelegramAuthData = {
  id: 42,
  first_name: "Ann",
  auth_date: 1_761_730_000,
  hash: "0".repeat(64),
};
const bob: TelegramAuthData = { ...ann, id: 43, first_name: "Bob" };

let $fetch: ReturnType<typeof vi.fn>;
const renderedWidgets: TelegramWidget[] = [];

function actions() {
  const $store = { notify: vi.fn(), listen: vi.fn(), atoms: {} };
  const client = telegramClient().getActions($fetch as any, $store);
  const remember = async (promise: Promise<TelegramWidget>) => {
    const widget = await promise;
    renderedWidgets.push(widget);
    return widget;
  };
  return {
    ...client,
    initTelegramWidget: (
      ...args: Parameters<typeof client.initTelegramWidget>
    ) => remember(client.initTelegramWidget(...args)),
    initTelegramWidgetRedirect: (
      ...args: Parameters<typeof client.initTelegramWidgetRedirect>
    ) => remember(client.initTelegramWidgetRedirect(...args)),
  };
}

function addContainer(id: string) {
  const container = document.createElement("div");
  container.id = id;
  document.body.appendChild(container);
  return container;
}

function widgetScript(containerId = "telegram-login") {
  return document.getElementById(containerId)!.querySelector("script")!;
}

/** What Telegram's widget does on login: calls `data-onauth` with `user`. */
function telegramLogsIn(containerId: string, user: TelegramAuthData) {
  const onauth = widgetScript(containerId).getAttribute("data-onauth")!;
  const name = onauth.replace(/\(user\)$/u, "");
  return (window as any)[name](user) as Promise<void>;
}

beforeEach(() => {
  $fetch = vi.fn().mockResolvedValue({ data: { botUsername: "test_bot" } });
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  // The widget script is already on the page unless a test removes it.
  (window as any).Telegram = { Login: {} };
  window.location.hash = "";
  addContainer("telegram-login");
});

afterEach(() => {
  for (const widget of renderedWidgets.splice(0)) {
    widget.destroy();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("initTelegramWidget", () => {
  it("preserves existing content when the configuration request fails", async () => {
    const container = document.getElementById("telegram-login")!;
    container.textContent = "Please try again";
    $fetch.mockResolvedValueOnce({ data: null, error: { status: 503 } });

    await expect(
      actions().initTelegramWidget(container, {}, () => {})
    ).rejects.toThrow("Failed to get Telegram config");

    expect(container.textContent).toBe("Please try again");
    expect(container.querySelector("script")).toBeNull();
  });

  it("rejects a missing container without mounting a widget elsewhere", async () => {
    await expect(
      actions().initTelegramWidget("missing", {}, () => {})
    ).rejects.toThrow('Container with id "missing" not found');

    expect(document.getElementById("telegram-login")!.children).toHaveLength(0);
  });

  it("rejects instead of rendering a widget for an empty bot username", async () => {
    $fetch.mockResolvedValueOnce({ data: { botUsername: "" } });

    await expect(
      actions().initTelegramWidget("telegram-login", {}, () => {})
    ).rejects.toThrow("Telegram plugin: botUsername is required");
    expect(document.querySelector("script")).toBeNull();
  });

  it("replaces previous content, so a re-render does not stack two widgets", async () => {
    const container = document.getElementById("telegram-login")!;
    container.innerHTML = "<div>Old content</div>";

    await actions().initTelegramWidget("telegram-login", {}, () => {});
    await actions().initTelegramWidget("telegram-login", {}, () => {});

    expect(container.querySelector("div")).toBeNull();
    expect(container.querySelectorAll("script")).toHaveLength(1);
  });

  it("embeds Telegram's widget script with the documented data attributes", async () => {
    await actions().initTelegramWidget(
      "telegram-login",
      { size: "medium", showUserPhoto: false, cornerRadius: 10, lang: "en" },
      () => {}
    );

    const script = widgetScript();
    expect(script.getAttribute("src")).toBe(WIDGET_SCRIPT);
    expect(script.getAttribute("data-telegram-login")).toBe("test_bot");
    expect(script.getAttribute("data-size")).toBe("medium");
    expect(script.getAttribute("data-userpic")).toBe("false");
    expect(script.getAttribute("data-radius")).toBe("10");
    expect(script.getAttribute("data-lang")).toBe("en");
    expect(script.getAttribute("data-onauth")).toMatch(/^\w+\(user\)$/u);
  });

  it("uses the documented defaults: large, with photo, radius 20, no write access", async () => {
    await actions().initTelegramWidget("telegram-login", {}, () => {});

    const script = widgetScript();
    expect(script.getAttribute("data-size")).toBe("large");
    expect(script.getAttribute("data-userpic")).toBe("true");
    expect(script.getAttribute("data-radius")).toBe("20");
    expect(script.hasAttribute("data-request-access")).toBe(false);
  });

  it("asks Telegram for write access with requestAccess", async () => {
    await actions().initTelegramWidget(
      "telegram-login",
      { requestAccess: true },
      () => {}
    );

    expect(widgetScript().getAttribute("data-request-access")).toBe("write");
  });

  it("routes each widget's login to its own onAuth, even when created in the same millisecond", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_761_730_000_000);
    addContainer("widget-b");
    const onAuthA = vi.fn();
    const onAuthB = vi.fn();
    await actions().initTelegramWidget("telegram-login", {}, onAuthA);
    await actions().initTelegramWidget("widget-b", {}, onAuthB);

    telegramLogsIn("telegram-login", ann);
    telegramLogsIn("widget-b", bob);

    expect(onAuthA).toHaveBeenCalledExactlyOnceWith(ann);
    expect(onAuthB).toHaveBeenCalledExactlyOnceWith(bob);
  });

  it("still reaches onAuth on a second login from the same page", async () => {
    const onAuth = vi.fn();
    await actions().initTelegramWidget("telegram-login", {}, onAuth);

    telegramLogsIn("telegram-login", ann);
    telegramLogsIn("telegram-login", bob);

    expect(onAuth.mock.calls).toEqual([[ann], [bob]]);
  });

  it("contains a rejected onAuth and still delivers the next login", async () => {
    const failure = new Error("sign-in failed");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const received: number[] = [];
    await actions().initTelegramWidget("telegram-login", {}, (user) => {
      if (user.id === ann.id) {
        return Promise.reject(failure);
      }
      received.push(user.id);
    });

    await telegramLogsIn("telegram-login", ann);
    await telegramLogsIn("telegram-login", bob);

    expect(received).toEqual([43]);
  });
});

describe("widget containers and teardown (React refs, StrictMode, HMR)", () => {
  /**
   * What telegram-widget.js?24 does: inserts its iframe before the script
   * and keeps it on the script as `_iframe`.
   */
  function telegramRendersIframe(container: HTMLElement) {
    const script = container.querySelector("script")!;
    const iframe = document.createElement("iframe");
    // Only DOM ownership matters here; do not navigate to an external frame.
    iframe.srcdoc = "<!doctype html><title>Telegram fixture</title>";
    iframe.id = "telegram-login-test_bot";
    container.insertBefore(iframe, script);
    (script as any)._iframe = iframe;
  }

  it("renders into an element passed instead of an id", async () => {
    const element = document.createElement("div");
    document.body.appendChild(element);

    await actions().initTelegramWidget(element, {}, () => {});
    await actions().initTelegramWidgetRedirect(element, "/cb", {});

    const scripts = element.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.getAttribute("data-auth-url")).toBe("/cb");
  });

  it("destroy() removes the widget and its global callback", async () => {
    const container = document.getElementById("telegram-login")!;
    const onAuth = vi.fn();

    const widget = await actions().initTelegramWidget(
      "telegram-login",
      {},
      onAuth
    );
    const callbackName = widgetScript()
      .getAttribute("data-onauth")!
      .replace(/\(user\)$/u, "");
    telegramRendersIframe(container);
    widget.destroy();

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(callbackName in window).toBe(false);
  });

  it("destroy() of the redirect widget removes it too", async () => {
    const container = document.getElementById("telegram-login")!;

    const widget = await actions().initTelegramWidgetRedirect(
      "telegram-login",
      "/cb",
      {}
    );
    telegramRendersIframe(container);
    widget.destroy();

    expect(container.children).toHaveLength(0);
  });

  it("destroy() leaves a widget rendered later into the same container alone", async () => {
    const container = document.getElementById("telegram-login")!;
    const first = await actions().initTelegramWidget(
      "telegram-login",
      {},
      () => {}
    );
    telegramRendersIframe(container);
    const laterLogin = vi.fn();
    await actions().initTelegramWidget("telegram-login", {}, laterLogin);
    telegramRendersIframe(container);

    first.destroy();
    await telegramLogsIn("telegram-login", bob);

    expect(container.querySelectorAll("script")).toHaveLength(1);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(laterLogin).toHaveBeenCalledExactlyOnceWith(bob);
  });
});

describe("initTelegramWidgetRedirect", () => {
  it("sends the login to data-auth-url and not to a callback", async () => {
    await actions().initTelegramWidgetRedirect(
      "telegram-login",
      "/auth/callback",
      {}
    );

    const script = widgetScript();
    expect(script.getAttribute("src")).toBe(WIDGET_SCRIPT);
    expect(script.getAttribute("data-telegram-login")).toBe("test_bot");
    expect(script.getAttribute("data-auth-url")).toBe("/auth/callback");
    expect(script.hasAttribute("data-onauth")).toBe(false);
  });

  it("applies every widget option", async () => {
    await actions().initTelegramWidgetRedirect("telegram-login", "/cb", {
      size: "small",
      showUserPhoto: false,
      cornerRadius: 5,
      requestAccess: true,
      lang: "pl",
    });

    const script = widgetScript();
    expect(script.getAttribute("data-size")).toBe("small");
    expect(script.getAttribute("data-userpic")).toBe("false");
    expect(script.getAttribute("data-radius")).toBe("5");
    expect(script.getAttribute("data-request-access")).toBe("write");
    expect(script.getAttribute("data-lang")).toBe("pl");
  });
});

describe("loading Telegram's widget script", () => {
  function controlScriptLoad() {
    (window as any).Telegram = undefined;
    const requested: HTMLScriptElement[] = [];
    // The network script is the boundary: complete its load/error explicitly.
    vi.spyOn(document.head, "appendChild").mockImplementation((element) => {
      requested.push(element as HTMLScriptElement);
      return element;
    });
    return requested;
  }

  it("shares an in-flight script load and renders only after it succeeds", async () => {
    const requested = controlScriptLoad();
    const first = actions().initTelegramWidget("telegram-login", {}, () => {});
    const second = actions().initTelegramWidget("telegram-login", {}, () => {});

    expect(requested).toHaveLength(1);
    expect(requested[0]!.src).toBe(WIDGET_SCRIPT);
    expect(document.getElementById("telegram-login")!.children).toHaveLength(0);
    requested[0]!.dispatchEvent(new Event("load"));
    await Promise.all([first, second]);

    expect(
      document.getElementById("telegram-login")!.querySelectorAll("script")
    ).toHaveLength(1);
  });

  it("rejects a failed script load and lets a later attempt recover", async () => {
    const requested = controlScriptLoad();
    const first = actions().initTelegramWidget("telegram-login", {}, () => {});
    const rejected = expect(first).rejects.toThrow(
      "Failed to load Telegram widget script"
    );
    requested[0]!.dispatchEvent(new Event("error"));
    await rejected;
    expect(document.getElementById("telegram-login")!.children).toHaveLength(0);

    const recovered = vi.fn();
    const retry = actions().initTelegramWidget("telegram-login", {}, recovered);
    expect(requested).toHaveLength(2);
    requested[1]!.dispatchEvent(new Event("load"));
    await retry;
    await telegramLogsIn("telegram-login", bob);

    expect(recovered).toHaveBeenCalledExactlyOnceWith(bob);
  });
});

describe("autoSignInFromMiniApp", () => {
  it("reports server-side use without attempting a sign-in request", async () => {
    vi.stubGlobal("window", undefined);
    try {
      await expect(actions().autoSignInFromMiniApp()).rejects.toThrow(
        "This method can only be called in browser"
      );
      expect($fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads tgWebAppData from the URL fragment once decoded when the SDK is absent", async () => {
    // Telegram's launch parameters: initData is URL-encoded inside the fragment.
    const initData = "user=%7B%22id%22%3A7%7D&auth_date=1761730000&hash=abc123";
    (window as any).Telegram = undefined;
    window.location.hash = `#tgWebAppVersion=9.0&tgWebAppData=${encodeURIComponent(initData)}&tgWebAppPlatform=ios`;

    await actions().autoSignInFromMiniApp();

    expect($fetch).toHaveBeenCalledExactlyOnceWith("/telegram/miniapp/signin", {
      method: "POST",
      body: { initData },
    });
  });

  it("refuses to call the server when the SDK is loaded outside Telegram (empty initData)", async () => {
    (window as any).Telegram = { WebApp: { initData: "" } };

    await expect(actions().autoSignInFromMiniApp()).rejects.toThrow(
      "Not running in Telegram Mini App or initData not available"
    );
    expect($fetch).not.toHaveBeenCalled();
  });
});
