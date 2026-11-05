import type { TelegramAuthData } from "../../dist/index.js";

export async function startLegacy(
  client: any,
  readSession: () => Promise<unknown>,
  show: (value: unknown) => void
) {
  let lastWidgetData: TelegramAuthData | undefined;
  async function run(action: string, task: () => Promise<any>) {
    try {
      const response = await task();
      if (response?.error) {
        show({
          action,
          status: response.error.status,
          error: response.error.code,
        });
      } else {
        await readSession();
      }
    } catch (error: any) {
      show({
        action,
        status: error.status,
        error: error.error?.code ?? error.code ?? error.name,
      });
    }
  }
  document
    .querySelector("#miniapp")!
    .addEventListener("click", () =>
      run("miniapp", () => client.autoSignInFromMiniApp({ throw: false }))
    );
  document
    .querySelector("#generated-unlink")!
    .addEventListener("click", () =>
      run("generated_unlink", () => client.telegram.unlink())
    );
  document.querySelector("#link-last")!.addEventListener("click", () => {
    if (!lastWidgetData) return show({ error: "widget_data_not_available" });
    return run("link", () =>
      client.linkTelegram(lastWidgetData, { throw: false })
    );
  });
  document.querySelector("#revoke")!.addEventListener("click", async () => {
    const response = await fetch("/legacy/revoke", {
      method: "POST",
      credentials: "same-origin",
    });
    show({ status: response.status, ...(await response.json()) });
  });
  const status = document.querySelector("#widget-status")!;
  try {
    await client.initTelegramWidget(
      "widget",
      { size: "large", showUserPhoto: false },
      async (data: TelegramAuthData) => {
        lastWidgetData = data;
        await run("widget_signin", () =>
          client.signInWithTelegram(data, { throw: false })
        );
      }
    );
    status.textContent = "Widget ready with global fetchOptions.throw: true";
  } catch {
    status.textContent = "Widget initialization failed";
  }
  const webApp = (window as any).Telegram?.WebApp;
  if (webApp?.initData) {
    webApp.ready();
    await run("miniapp_auto", () =>
      client.autoSignInFromMiniApp({ throw: false })
    );
  }
}
