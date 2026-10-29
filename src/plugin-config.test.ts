// @vitest-environment node
/**
 * Startup warnings. Construction must never throw (build environments have
 * no secrets), so missing or risky configuration is reported with a warning.
 */
import { describe, expect, it, vi } from "vitest";
import { createPluginConfig } from "./plugin-config";

const BASE = {
  botToken: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
  botUsername: "test_bot",
};

describe("createPluginConfig", () => {
  it("warns instead of throwing when the default Widget flow has no botToken", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => createPluginConfig({ botUsername: "bot" })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("botToken is required")
    );

    warnSpy.mockRestore();
  });

  it("warns instead of throwing when the default Widget flow has no botUsername", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => createPluginConfig({ botToken: "tok:en" })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("botUsername is required")
    );

    warnSpy.mockRestore();
  });

  it("does not warn about bot credentials in an OIDC-only configuration", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    createPluginConfig({
      loginWidget: false,
      oidc: {
        enabled: true,
        clientId: "123456789",
        clientSecret: "oidc-secret",
      },
    });

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

  it("warns when the Login Widget and OIDC would share one bot", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createPluginConfig({ ...BASE, oidc: { enabled: true, clientSecret: "s" } });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain(
      "permanently disables its legacy Login Widget"
    );
    spy.mockRestore();
  });

  it("does not warn about sharing a bot when OIDC uses its own client", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createPluginConfig({
      ...BASE,
      loginWidget: false,
      oidc: { enabled: true, clientSecret: "s" },
    });
    createPluginConfig({
      ...BASE,
      oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warns when Mini App initData validation is off", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createPluginConfig({
      ...BASE,
      miniApp: { enabled: true, validateInitData: false },
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain(
      "anyone can sign in as any Telegram user"
    );
    spy.mockRestore();
  });

  it("warns when testMode and oidc are both enabled", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createPluginConfig({
      ...BASE,
      testMode: true,
      oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain("testMode is enabled with OIDC");
    spy.mockRestore();
  });

  it("does not warn about testMode when OIDC is disabled", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    createPluginConfig({ ...BASE, testMode: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
