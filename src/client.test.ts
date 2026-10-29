/**
 * @vitest-environment happy-dom
 *
 * Browser-side behavior of the client plugin: the Telegram widget embed and
 * Mini App initData discovery. Server round trips are covered against a real
 * Better Auth instance in client.integration.test.ts; here `$fetch` only
 * supplies the bot configuration the widget needs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramClient } from "./client";
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

function actions() {
  return telegramClient().getActions($fetch as any);
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
  (window as any)[name](user);
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  (window as any).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
});

describe("initTelegramWidget", () => {
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

  it("passes the user Telegram returns to onAuth", async () => {
    const onAuth = vi.fn();
    await actions().initTelegramWidget("telegram-login", {}, onAuth);

    telegramLogsIn("telegram-login", ann);

    expect(onAuth).toHaveBeenCalledExactlyOnceWith(ann);
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

  it("reports a failing onAuth with console.error instead of an unhandled rejection", async () => {
    const failure = new Error("sign-in failed");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await actions().initTelegramWidget("telegram-login", {}, () =>
        Promise.reject(failure)
      );

      telegramLogsIn("telegram-login", ann);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("onAuth"),
        failure
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
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

  it("uses the documented defaults: large, with photo, radius 20", async () => {
    await actions().initTelegramWidgetRedirect("telegram-login", "/cb", {});

    const script = widgetScript();
    expect(script.getAttribute("data-size")).toBe("large");
    expect(script.getAttribute("data-userpic")).toBe("true");
    expect(script.getAttribute("data-radius")).toBe("20");
    expect(script.hasAttribute("data-request-access")).toBe(false);
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

  it("replaces previous content, so a re-render does not stack two widgets", async () => {
    const container = document.getElementById("telegram-login")!;
    container.innerHTML = "<p>Old content</p>";

    await actions().initTelegramWidgetRedirect("telegram-login", "/cb", {});

    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelectorAll("script")).toHaveLength(1);
  });
});

describe("loading Telegram's widget script", () => {
  it("loads the script into <head> once when it is not on the page yet", async () => {
    (window as any).Telegram = undefined;

    await actions().initTelegramWidget("telegram-login", {}, () => {});

    const loaded = document.head.querySelectorAll("script");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.getAttribute("src")).toBe(WIDGET_SCRIPT);
  });

  it("rejects without rendering a widget when the script fails to load", async () => {
    (window as any).Telegram = undefined;
    // happy-dom then logs a DOMException for the refused load; that is expected.
    (window as any).happyDOM.settings.handleDisabledFileLoadingAsSuccess =
      false;

    await expect(
      actions().initTelegramWidget("telegram-login", {}, () => {})
    ).rejects.toThrow("Failed to load Telegram widget script");
    expect(
      document.getElementById("telegram-login")!.querySelector("script")
    ).toBeNull();
  });
});

describe("autoSignInFromMiniApp", () => {
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
