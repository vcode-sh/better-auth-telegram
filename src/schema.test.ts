import { describe, expect, it } from "vitest";
import type { TelegramPluginConfig } from "./plugin-config";
import { createTelegramSchema } from "./schema";

function makeConfig(
  overrides: Partial<TelegramPluginConfig> = {}
): TelegramPluginConfig {
  return {
    botToken: "tok",
    botUsername: "bot",
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

describe("createTelegramSchema", () => {
  it("returns schema when widget is enabled", () => {
    const schema = createTelegramSchema(
      makeConfig({ widgetEnabled: true, miniAppEnabled: false })
    );
    expect(schema).toBeDefined();
    expect(schema!.user!.fields).toHaveProperty("telegramId");
    expect(schema!.user!.fields).toHaveProperty("telegramUsername");
    expect(schema!.user!.fields).toHaveProperty("telegramPhoneNumber");
    expect(schema!.account!.fields).toHaveProperty("telegramId");
    expect(schema!.account!.fields).toHaveProperty("telegramUsername");
  });

  it("returns schema when miniApp is enabled (widget disabled)", () => {
    const schema = createTelegramSchema(
      makeConfig({ widgetEnabled: false, miniAppEnabled: true })
    );
    expect(schema).toBeDefined();
    expect(schema!.user!.fields).toHaveProperty("telegramId");
  });

  it("returns schema when both widget and miniApp are enabled", () => {
    const schema = createTelegramSchema(
      makeConfig({ widgetEnabled: true, miniAppEnabled: true })
    );
    expect(schema).toBeDefined();
  });

  it("returns undefined when neither widget nor miniApp is enabled (OIDC-only)", () => {
    const schema = createTelegramSchema(
      makeConfig({ widgetEnabled: false, miniAppEnabled: false })
    );
    expect(schema).toBeUndefined();
  });

  it("user fields have correct structure (type, required, unique, input)", () => {
    const schema = createTelegramSchema(makeConfig())!;
    const userFields = schema.user!.fields;

    for (const field of Object.values(userFields)) {
      expect(field.type).toBe("string");
      expect(field.required).toBe(false);
      expect(field.unique).toBe(false);
      expect((field as any).input).toBe(false);
    }
  });

  it("account fields have correct structure (type, required, unique, no input)", () => {
    const schema = createTelegramSchema(makeConfig())!;
    const accountFields = schema.account!.fields;

    for (const field of Object.values(accountFields)) {
      expect(field.type).toBe("string");
      expect(field.required).toBe(false);
      expect(field.unique).toBe(false);
    }
  });

  it("has exactly 3 user fields and 2 account fields", () => {
    const schema = createTelegramSchema(makeConfig())!;
    expect(Object.keys(schema.user!.fields)).toHaveLength(3);
    expect(Object.keys(schema.account!.fields)).toHaveLength(2);
  });
});
