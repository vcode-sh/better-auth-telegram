import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_AUTH_AGE, ERROR_CODES } from "./constants";
import { createPluginConfig } from "./plugin-config";

const BASE = {
  botToken: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
  botUsername: "test_bot",
};

describe("createPluginConfig", () => {
  // ── Validation ─────────────────────────────────────────────────────

  it("warns instead of throwing when the default Widget flow has no botToken", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => createPluginConfig({ botUsername: "bot" })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(ERROR_CODES.BOT_TOKEN_REQUIRED.message)
    );

    warnSpy.mockRestore();
  });

  it("warns instead of throwing when the default Widget flow has no botUsername", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => createPluginConfig({ botToken: "tok:en" })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(ERROR_CODES.BOT_USERNAME_REQUIRED.message)
    );

    warnSpy.mockRestore();
  });

  it("allows OIDC-only configuration with explicit OIDC credentials", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = createPluginConfig({
      loginWidget: false,
      oidc: {
        enabled: true,
        clientId: "123456789",
        clientSecret: "oidc-secret",
      },
    });

    expect(config.botToken).toBe("");
    expect(config.botUsername).toBe("");
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("warns for each missing credential in an OIDC-only configuration", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    createPluginConfig({
      loginWidget: false,
      oidc: { enabled: true },
    });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0]![0]).toContain("clientId is required");
    expect(warnSpy.mock.calls[1]![0]).toContain("clientSecret is required");

    warnSpy.mockRestore();
  });

  it("does not require botUsername for a Mini App-only configuration", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    createPluginConfig({
      botToken: "tok:en",
      loginWidget: false,
      miniApp: { enabled: true },
    });

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  // ── Defaults ───────────────────────────────────────────────────────

  it("applies all defaults with minimal options", () => {
    const config = createPluginConfig(BASE);

    expect(config.widgetEnabled).toBe(true);
    expect(config.miniAppEnabled).toBe(false);
    expect(config.oidcEnabled).toBe(false);
    expect(config.testMode).toBe(false);
    expect(config.allowUserToLink).toBe(true);
    expect(config.autoCreateUser).toBe(true);
    expect(config.maxAuthAge).toBe(DEFAULT_MAX_AUTH_AGE);
    expect(config.miniAppValidateInitData).toBe(true);
    expect(config.miniAppAllowAutoSignin).toBe(true);
    expect(config.mapTelegramDataToUser).toBeUndefined();
    expect(config.mapMiniAppDataToUser).toBeUndefined();
    expect(config.oidc).toBeUndefined();
  });

  // ── Feature flags ──────────────────────────────────────────────────

  it("loginWidget: false disables widget", () => {
    const config = createPluginConfig({ ...BASE, loginWidget: false });
    expect(config.widgetEnabled).toBe(false);
  });

  it("loginWidget: undefined keeps widget enabled (backward compat)", () => {
    const config = createPluginConfig(BASE);
    expect(config.widgetEnabled).toBe(true);
  });

  it("miniApp.enabled: true enables mini app", () => {
    const config = createPluginConfig({
      ...BASE,
      miniApp: { enabled: true },
    });
    expect(config.miniAppEnabled).toBe(true);
  });

  it("oidc.enabled: true enables OIDC", () => {
    const config = createPluginConfig({
      ...BASE,
      oidc: { enabled: true },
    });
    expect(config.oidcEnabled).toBe(true);
    expect(config.oidc).toEqual({ enabled: true });
  });

  // ── Mini App sub-options ───────────────────────────────────────────

  it("passes miniApp sub-options through", () => {
    const mapper = () => ({ name: "custom" });
    const config = createPluginConfig({
      ...BASE,
      miniApp: {
        enabled: true,
        validateInitData: false,
        allowAutoSignin: false,
        mapMiniAppDataToUser: mapper,
      },
    });
    expect(config.miniAppValidateInitData).toBe(false);
    expect(config.miniAppAllowAutoSignin).toBe(false);
    expect(config.mapMiniAppDataToUser).toBe(mapper);
  });

  // ── Custom overrides ───────────────────────────────────────────────

  it("respects explicit overrides for all boolean/number options", () => {
    const config = createPluginConfig({
      ...BASE,
      allowUserToLink: false,
      autoCreateUser: false,
      maxAuthAge: 300,
      testMode: true,
    });
    expect(config.allowUserToLink).toBe(false);
    expect(config.autoCreateUser).toBe(false);
    expect(config.maxAuthAge).toBe(300);
    expect(config.testMode).toBe(true);
  });

  it("passes mapTelegramDataToUser through", () => {
    const mapper = () => ({ name: "mapped" });
    const config = createPluginConfig({
      ...BASE,
      mapTelegramDataToUser: mapper,
    });
    expect(config.mapTelegramDataToUser).toBe(mapper);
  });

  // ── testMode + OIDC warning ────────────────────────────────────────

  it("warns when testMode and oidc are both enabled", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createPluginConfig({
      ...BASE,
      testMode: true,
      oidc: { enabled: true },
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain("testMode is enabled with OIDC");
    spy.mockRestore();
  });

  it("does NOT warn when testMode is true but oidc is disabled", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createPluginConfig({ ...BASE, testMode: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does NOT warn when oidc is enabled but testMode is false", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createPluginConfig({ ...BASE, oidc: { enabled: true } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
