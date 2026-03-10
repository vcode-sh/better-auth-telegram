/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("better-auth/api", () => ({
  createAuthEndpoint: vi.fn(
    (_path: string, _options: any, handler: any) => handler
  ),
}));

import { createConfigEndpoint } from "./config-endpoint";
import type { TelegramPluginConfig } from "./plugin-config";

function makeConfig(
  overrides: Partial<TelegramPluginConfig> = {}
): TelegramPluginConfig {
  return {
    botToken: "tok:en",
    botUsername: "my_bot",
    widgetEnabled: true,
    miniAppEnabled: false,
    oidcEnabled: false,
    testMode: false,
    allowUserToLink: true,
    autoCreateUser: true,
    maxAuthAge: 86400,
    miniAppValidateInitData: true,
    miniAppAllowAutoSignin: true,
    ...overrides,
  };
}

function mockCtx() {
  return { json: vi.fn((data: any) => data) };
}

describe("createConfigEndpoint", () => {
  it("returns endpoint object with getTelegramConfig key", () => {
    const result = createConfigEndpoint(makeConfig());
    expect(result).toHaveProperty("getTelegramConfig");
    expect(typeof result.getTelegramConfig).toBe("function");
  });

  it("returns all config fields with defaults", async () => {
    const endpoint = createConfigEndpoint(makeConfig());
    const ctx = mockCtx();
    await (endpoint.getTelegramConfig as any)(ctx);

    expect(ctx.json).toHaveBeenCalledWith({
      botUsername: "my_bot",
      loginWidgetEnabled: true,
      miniAppEnabled: false,
      oidcEnabled: false,
      testMode: false,
    });
  });

  it("reflects widget disabled", async () => {
    const endpoint = createConfigEndpoint(
      makeConfig({ widgetEnabled: false })
    );
    const ctx = mockCtx();
    await (endpoint.getTelegramConfig as any)(ctx);

    expect(ctx.json).toHaveBeenCalledWith(
      expect.objectContaining({ loginWidgetEnabled: false })
    );
  });

  it("reflects all features enabled", async () => {
    const endpoint = createConfigEndpoint(
      makeConfig({
        widgetEnabled: true,
        miniAppEnabled: true,
        oidcEnabled: true,
        testMode: true,
      })
    );
    const ctx = mockCtx();
    await (endpoint.getTelegramConfig as any)(ctx);

    expect(ctx.json).toHaveBeenCalledWith({
      botUsername: "my_bot",
      loginWidgetEnabled: true,
      miniAppEnabled: true,
      oidcEnabled: true,
      testMode: true,
    });
  });

  it("never leaks botToken", async () => {
    const endpoint = createConfigEndpoint(makeConfig());
    const ctx = mockCtx();
    await (endpoint.getTelegramConfig as any)(ctx);

    const response = ctx.json.mock.calls[0]![0];
    expect(response).not.toHaveProperty("botToken");
    expect(JSON.stringify(response)).not.toContain("tok:en");
  });
});
