// @vitest-environment happy-dom
import { createAuthClient } from "better-auth/client";
import { afterEach, expect, it as test, vi } from "vitest";
import { telegramClient } from "./client";
import {
  createTelegramWidgetActions,
  type TelegramWidget,
} from "./client-widget";
import { BASE_URL, createMemoryAuth } from "./testing/harness";
import type { TelegramAuthData } from "./types";

const handles: TelegramWidget[] = [];
const callbacks = new Set<string>();

function pendingConfig() {
  let resolve!: (value: { data: { botUsername: string } }) => void;
  const promise = new Promise<{ data: { botUsername: string } }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function callbackFrom(element: HTMLElement) {
  const script = element.querySelector("script")!;
  const name = script.getAttribute("data-onauth")!.replace(/\(user\)$/u, "");
  callbacks.add(name);
  return (window as any)[name] as (user: TelegramAuthData) => Promise<void>;
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.destroy();
  }
  for (const callback of callbacks) {
    delete (window as any)[callback];
  }
  callbacks.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
});

test("renders the widget when the auth client uses throwing fetch responses", async () => {
  (window as any).Telegram = { Login: {} };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const { auth } = createMemoryAuth();
  const client = createAuthClient({
    baseURL: BASE_URL,
    plugins: [telegramClient()],
    fetchOptions: {
      throw: true,
      customFetchImpl: (input, init) => auth.handler(new Request(input, init)),
    },
  });
  const onAuth = vi.fn();

  const widget = await client.initTelegramWidget(host, {}, onAuth);
  handles.push(widget);
  const user: TelegramAuthData = {
    id: 42,
    first_name: "Ann",
    auth_date: 1,
    hash: "x",
  };
  await callbackFrom(host)(user);

  expect(onAuth).toHaveBeenCalledExactlyOnceWith(user);
  expect(
    host.querySelector("script")!.getAttribute("data-telegram-login")
  ).toBe("test_bot");
});

test.each(["callback", "redirect"] as const)(
  "keeps the newest requested widget when an older %s configuration arrives last",
  async (mode) => {
    (window as any).Telegram = { Login: {} };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const oldConfig = pendingConfig();
    const newConfig = pendingConfig();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(oldConfig.promise)
      .mockReturnValueOnce(newConfig.promise);
    const actions = createTelegramWidgetActions(fetch as any);
    const oldLogin = vi.fn();
    const newLogin = vi.fn();
    const oldInitialization =
      mode === "callback"
        ? actions.initTelegramWidget(host, { size: "small" }, oldLogin)
        : actions.initTelegramWidgetRedirect(host, "/obsolete", {
            size: "small",
          });
    const newInitialization = actions.initTelegramWidget(
      host,
      { size: "large" },
      newLogin
    );

    newConfig.resolve({ data: { botUsername: "current_bot" } });
    const current = await newInitialization;
    handles.push(current);
    oldConfig.resolve({ data: { botUsername: "obsolete_bot" } });
    const obsolete = await oldInitialization;
    handles.push(obsolete);

    const user: TelegramAuthData = {
      id: 42,
      first_name: "Ann",
      auth_date: 1,
      hash: "x",
    };
    await callbackFrom(host)(user);
    expect(newLogin).toHaveBeenCalledExactlyOnceWith(user);
    expect(oldLogin).not.toHaveBeenCalled();
    expect(
      host.querySelector("script")!.getAttribute("data-telegram-login")
    ).toBe("current_bot");
    obsolete.destroy();
    expect(host.querySelector("script")!.getAttribute("data-size")).toBe(
      "large"
    );
    current.destroy();
    expect(host.children).toHaveLength(0);
  }
);
