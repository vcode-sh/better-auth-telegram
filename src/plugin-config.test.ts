// @vitest-environment node
/**
 * Startup diagnostics. Construction must never throw (build environments
 * have no secrets), so missing or risky configuration becomes a warning,
 * which `init` logs through Better Auth's logger (see
 * plugin.integration.test.ts).
 */
import { describe, expect, it } from "vitest";
import { createPluginConfig } from "./plugin-config";

const BASE = {
  botToken: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
  botUsername: "test_bot",
};

const warnings = (options: Parameters<typeof createPluginConfig>[0]) =>
  createPluginConfig(options).warnings;

describe("createPluginConfig", () => {
  it("warns instead of throwing when the default Widget flow has no botToken", () => {
    expect(warnings({ botUsername: "bot" })).toEqual([
      expect.stringContaining("botToken is required"),
    ]);
  });

  it("warns instead of throwing when the default Widget flow has no botUsername", () => {
    expect(warnings({ botToken: BASE.botToken })).toEqual([
      expect.stringContaining("botUsername is required"),
    ]);
  });

  it("is silent for a correct configuration of every flow", () => {
    expect(
      warnings({
        ...BASE,
        miniApp: { enabled: true },
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      })
    ).toEqual([]);
  });

  it("does not warn about bot credentials in an OIDC-only configuration", () => {
    expect(
      warnings({
        loginWidget: false,
        oidc: { enabled: true, clientId: "123456789", clientSecret: "s" },
      })
    ).toEqual([]);
  });

  it("warns for each missing credential in an OIDC-only configuration", () => {
    expect(warnings({ loginWidget: false, oidc: { enabled: true } })).toEqual([
      expect.stringContaining("clientId is required"),
      expect.stringContaining("clientSecret is required"),
    ]);
  });

  it("does not require botUsername for a Mini App-only configuration", () => {
    expect(
      warnings({
        botToken: BASE.botToken,
        loginWidget: false,
        miniApp: { enabled: true },
      })
    ).toEqual([]);
  });

  // A trailing newline from an env file makes every HMAC check fail (401);
  // Telegram's tokens are `<bot id>:<secret>`, e.g.
  // "110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" (core.telegram.org/bots/features).
  it("trims whitespace around the bot token, and says so", () => {
    const config = createPluginConfig({
      ...BASE,
      botToken: ` ${BASE.botToken}\n`,
    });

    expect(config.botToken).toBe(BASE.botToken);
    expect(config.warnings).toEqual([
      expect.stringContaining("whitespace around botToken"),
    ]);
  });

  it.each(["123456789", "bot123:abc", "123456789:abc def", "abc:def"])(
    "warns about a bot token shaped %j",
    (botToken) => {
      expect(warnings({ ...BASE, botToken })).toContainEqual(
        expect.stringContaining("doesn't look like a bot token")
      );
    }
  );

  it("strips a leading @ from botUsername (the widget wants the bare name)", () => {
    const config = createPluginConfig({ ...BASE, botUsername: "@test_bot" });

    expect(config.botUsername).toBe("test_bot");
    expect(config.warnings).toEqual([
      expect.stringContaining('botUsername "@test_bot"'),
    ]);
  });

  it.each([
    ["no oidc.clientId", { enabled: true, clientSecret: "s" }],
    [
      "oidc.clientId = the Login Widget bot's id",
      { enabled: true, clientId: "123456789", clientSecret: "s" },
    ],
  ])(
    "warns when the Login Widget and OIDC would share one bot (%s)",
    (_case, oidc) => {
      expect(warnings({ ...BASE, oidc })).toEqual([
        expect.stringContaining("permanently disables its legacy Login Widget"),
      ]);
    }
  );

  it("does not warn about sharing a bot when OIDC uses its own client", () => {
    expect(
      warnings({
        ...BASE,
        loginWidget: false,
        oidc: { enabled: true, clientSecret: "s" },
      })
    ).toEqual([]);
    expect(
      warnings({
        ...BASE,
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      })
    ).toEqual([]);
  });

  // OIDC-only mode adds no Telegram columns, so there is nowhere to copy
  // the phone number to.
  it("warns when requestPhone has no telegramPhoneNumber column to fill", () => {
    const oidc = {
      enabled: true,
      clientId: "987654321",
      clientSecret: "s",
      requestPhone: true,
    };

    expect(warnings({ loginWidget: false, oidc })).toEqual([
      expect.stringContaining("requestPhone"),
    ]);
    expect(
      warnings({
        ...BASE,
        loginWidget: false,
        miniApp: { enabled: true },
        oidc,
      })
    ).toEqual([]);
  });

  it("warns when Mini App initData validation is off", () => {
    expect(
      warnings({ ...BASE, miniApp: { enabled: true, validateInitData: false } })
    ).toEqual([
      expect.stringContaining("anyone can sign in as any Telegram user"),
    ]);
  });

  it("warns when testMode and oidc are both enabled", () => {
    expect(
      warnings({
        ...BASE,
        testMode: true,
        oidc: { enabled: true, clientId: "987654321", clientSecret: "s" },
      })
    ).toEqual([expect.stringContaining("testMode is enabled with OIDC")]);
  });

  it("does not warn about testMode when OIDC is disabled", () => {
    expect(warnings({ ...BASE, testMode: true })).toEqual([]);
  });
});
