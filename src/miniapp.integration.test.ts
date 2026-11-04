// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryAuth,
  createSqliteAuth,
  signInitData,
  signInitParams,
  signWidgetData,
} from "./testing/harness";

const widgetUser = (id = 42, extra: Record<string, string | number> = {}) =>
  signWidgetData({ id, first_name: "Ann", username: "ann", ...extra });

describe("Mini App sign-in", () => {
  const miniApp = { miniApp: { enabled: true } };

  it("works on a SQL database with the schema Better Auth generates", async () => {
    const { client, rows } = await createSqliteAuth(miniApp);

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7, username: "ann" }),
    });

    expect(response.status).toBe(200);
    expect(rows("user")[0]).toMatchObject({
      email: "7@telegram.placeholder.invalid",
      telegramId: "7",
      telegramUsername: "ann",
    });
  });

  // Opened from the attachment menu in a private chat, initData also carries
  // the chat partner (`receiver`); from a direct link, chat_type and
  // chat_instance; plus start_param and can_send_after
  // (https://core.telegram.org/bots/webapps#webappinitdata).
  it("signs in the user who opened the Mini App, never the chat partner", async () => {
    const { client, db } = createMemoryAuth(miniApp);

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData(
        { id: 7, first_name: "Ann" },
        {
          receiver: JSON.stringify({
            id: 99,
            first_name: "Bob",
            is_bot: false,
          }),
          chat_type: "private",
          chat_instance: "-8834455221",
          start_param: "ref_42",
          can_send_after: "10",
        }
      ),
    });

    expect(response.status).toBe(200);
    expect(response.json.user).toMatchObject({ telegramId: "7", name: "Ann" });
    expect(db.user.map((user) => user.telegramId)).toEqual(["7"]);
  });

  it("signs a Login Widget user into the same account", async () => {
    const { client, db } = createMemoryAuth(miniApp);
    const widget = await client.post("/telegram/signin", await widgetUser(7));
    expect(widget.status).toBe(200);
    client.clearCookies();

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7 }),
    });

    const session = await client.get("/get-session");
    expect(response.status).toBe(200);
    expect(response.json.user.id).toBe(widget.json.user.id);
    expect(session.json.user.id).toBe(widget.json.user.id);
    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(1);
  });

  it("honors user.validateUserInfo and reports the Mini App as the method", async () => {
    const validateUserInfo = vi.fn(async () => ({ error: "not_invited" }));
    const { client, db } = createMemoryAuth(miniApp, {
      user: { validateUserInfo },
    });

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7 }),
    });

    expect(response.status).toBe(403);
    expect(validateUserInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          action: "create-user",
          method: "telegram-mini-app",
        }),
      }),
      expect.anything()
    );
    expect(db.user).toHaveLength(0);
  });

  it("rejects tampered initData", async () => {
    const { client, db } = createMemoryAuth(miniApp);
    const initData = (await signInitData({ id: 7 })).replace("Ann", "Bob");

    const response = await client.post("/telegram/miniapp/signin", {
      initData,
    });

    expect(response.status).toBe(401);
    expect(response.json.code).toBe("INVALID_MINI_APP_INIT_DATA");
    expect(db.user).toHaveLength(0);
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  it("returns decoded user and chat data without creating a user, account or session", async () => {
    const { client, db } = createMemoryAuth(miniApp);

    const response = await client.post("/telegram/miniapp/validate", {
      initData: await signInitData(
        { id: 7, username: "ann" },
        {
          chat: '{"id":-100123,"type":"supergroup","title":"Ann’s group"}',
          start_param: "ref123",
          can_send_after: "10",
        }
      ),
    });

    expect(response.status).toBe(200);
    expect(response.json.valid).toBe(true);
    expect(response.json.data).toMatchObject({
      user: { id: 7, username: "ann" },
      chat: { id: -100123, type: "supergroup", title: "Ann’s group" },
      start_param: "ref123",
      can_send_after: 10,
    });
    expect(db.user).toHaveLength(0);
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
    expect(client.hasSession()).toBe(false);
  });
});

describe("Mini App request validation", () => {
  const miniApp = (options = {}) => ({
    miniApp: { enabled: true, ...options },
  });

  it("answers 400 without initData", async () => {
    const { client } = createMemoryAuth(miniApp());

    const signIn = await client.post("/telegram/miniapp/signin", {});
    const validate = await client.post("/telegram/miniapp/validate", {});

    expect(signIn.status).toBe(400);
    expect(signIn.json.code).toBe("INIT_DATA_REQUIRED");
    expect(validate.status).toBe(400);
    expect(validate.json.code).toBe("INIT_DATA_REQUIRED");
  });

  it("answers 500 when the bot token is not configured", async () => {
    const { client } = createMemoryAuth({ botToken: "", ...miniApp() });
    const initData = await signInitData({ id: 7 });

    const signIn = await client.post("/telegram/miniapp/signin", { initData });
    const validate = await client.post("/telegram/miniapp/validate", {
      initData,
    });

    expect(signIn.status).toBe(500);
    expect(signIn.json.code).toBe("BOT_TOKEN_REQUIRED");
    expect(validate.status).toBe(500);
    expect(validate.json.code).toBe("BOT_TOKEN_REQUIRED");
  });

  it.each([undefined, "{invalid json}"])(
    "rejects missing or unparseable user data without writes (user %s)",
    async (user) => {
      const { client, db } = createMemoryAuth(miniApp());
      const initData = await signInitParams({
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
        ...(user === undefined ? {} : { user }),
      });

      const response = await client.post("/telegram/miniapp/signin", {
        initData,
      });

      expect(response.status).toBe(400);
      expect(response.json.code).toBe("NO_USER_IN_INIT_DATA");
      expect(db.user).toHaveLength(0);
      expect(db.account).toHaveLength(0);
      expect(db.session).toHaveLength(0);
      expect(client.hasSession()).toBe(false);
    }
  );

  it.each([true, false])(
    "rejects a null Mini App user when signature validation is %s",
    async (validateInitData) => {
      const { client, db } = createMemoryAuth(miniApp({ validateInitData }));
      const initData = await signInitParams({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: "null",
      });

      const response = await client.post("/telegram/miniapp/signin", {
        initData,
      });

      expect(response.status).toBe(400);
      expect(response.json.code).toBe("INVALID_MINI_APP_DATA_STRUCTURE");
      expect(client.hasSession()).toBe(false);
      expect(db.user).toHaveLength(0);
    }
  );

  it("answers 400 for unsigned data with a broken structure when validation is off", async () => {
    const { client } = createMemoryAuth(miniApp({ validateInitData: false }));

    const response = await client.post("/telegram/miniapp/signin", {
      initData: "user=%7B%7D&hash=x",
    });

    expect(response.status).toBe(400);
    expect(response.json.code).toBe("INVALID_MINI_APP_DATA_STRUCTURE");
  });

  // Without signature checks the bot token has no use on this route.
  it("signs in without a bot token when validation is off", async () => {
    const { client } = createMemoryAuth({
      botToken: "",
      loginWidget: false,
      miniApp: { enabled: true, validateInitData: false },
    });

    const response = await client.post("/telegram/miniapp/signin", {
      initData: `user=${encodeURIComponent('{"id":7,"first_name":"Ann"}')}&auth_date=1&hash=x`,
    });

    expect(response.status).toBe(200);
    expect(response.json.user.telegramId).toBe("7");
  });

  it("answers 404 when auto sign-up from Mini Apps is disabled", async () => {
    const { client, db } = createMemoryAuth(
      miniApp({ allowAutoSignin: false })
    );

    const response = await client.post("/telegram/miniapp/signin", {
      initData: await signInitData({ id: 7 }),
    });

    expect(response.status).toBe(404);
    expect(response.json.code).toBe("MINI_APP_AUTO_SIGNIN_DISABLED");
    expect(db.user).toHaveLength(0);
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  it("reports invalid initData from the validate endpoint", async () => {
    const { client } = createMemoryAuth(miniApp());
    const initData = (await signInitData({ id: 7 })).replace("Ann", "Bob");

    const response = await client.post("/telegram/miniapp/validate", {
      initData,
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ valid: false, data: null });
  });
});
