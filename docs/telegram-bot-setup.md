# Telegram bot setup

Every Telegram sign-in goes through a bot that you own. This page shows how to create one and how to configure it in [@BotFather](https://t.me/botfather) for each sign-in method, with what you should see after each step.

You only need the sections for the methods you use:

- [Create a bot](#create-a-bot) (everyone)
- [Login Widget](#login-widget)
- [Mini App](#mini-app)
- [OIDC](#oidc)
- [Using more than one method](#using-more-than-one-method)
- [Changing the bot token later](#changing-the-bot-token-later)
- [Telegram's test environment](#telegrams-test-environment)

> **Before you start: you need a public HTTPS address.** Telegram does not accept `localhost`. For development, start a tunnel first (for example `ngrok http 3000`) and use the HTTPS address it prints. See [Local development](./installation.md#local-development-with-a-tunnel).

## Create a bot

BotFather works in two ways: you can chat with it and send commands, or open its Mini App for a menu-based interface. Both change the same settings. Bot creation below uses commands; OIDC settings are in the Mini App.

1. Open a chat with [@BotFather](https://t.me/botfather) and send `/newbot`.
2. BotFather asks for a **name**. This is what users see when they confirm a sign-in, so use your app's name, for example `My App`.
3. BotFather asks for a **username**. It must be 5 to 32 characters (Latin letters, numbers and underscores) and **must end in `bot`**, for example `my_app_login_bot`. You can't change it later.
4. BotFather replies with your **bot token**, a string like `110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`.

Put both values in your server's environment:

```bash
TELEGRAM_BOT_TOKEN="110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
TELEGRAM_BOT_USERNAME="my_app_login_bot"   # without the @
```

> **Keep the token secret.** Anyone who has it can control your bot and create sign-in data the plugin would accept. Keep it in environment variables on the server, never in browser code or in git.

Telegram recommends giving the bot your app's name and logo, because users see them when they confirm the sign-in ([Telegram's advice](https://core.telegram.org/widgets/login-legacy)). You can set a picture with `/setuserpic`.

## Login Widget

The Login Widget only shows up on a domain you have linked to the bot.

1. In the chat with BotFather, send `/setdomain`.
2. Pick your bot from the list.
3. Send your domain **without** `https://` and without a path, for example `example.com` or `abc123.ngrok-free.app`.

BotFather confirms the change. That's all the widget needs. In the plugin you use `botToken` and `botUsername` from [Create a bot](#create-a-bot).

If your tunnel address changes (free ngrok gives you a new one each time it starts), run `/setdomain` again with the new domain.

## Mini App

A Mini App is your website, opened inside Telegram. Telegram's Mini App docs give this path to turn it on:

1. Send `/mybots` to BotFather and pick your bot.
2. Choose **Bot Settings** > **Configure Mini App** > **Enable Mini App**.
3. Send the HTTPS address of your app, for example `https://abc123.ngrok-free.app`.

Users can then open the app from the bot's profile, or with a link like `https://t.me/my_app_login_bot?startapp`. Telegram supports other ways to launch Mini Apps too (menu button, inline buttons, direct links like `https://t.me/<bot>/<app>`); see [Telegram's list](https://core.telegram.org/bots/webapps).

> **Keyboard buttons and inline mode don't work for sign-in.** Telegram leaves `initData` empty when a Mini App is launched from a keyboard button or from inline mode, so there is nothing to sign in with. Launch it from the profile button, the menu button, an inline button or a link.

The Mini App must belong to the same bot as `botToken`, because Telegram signs `initData` with that bot's token. In the plugin you need `botToken` and `miniApp: { enabled: true }`. Next: [Mini Apps guide](./miniapps.md).

## OIDC

OIDC settings live in BotFather's Mini App, on the bot's **Login Widget** page.

> **Read this first.** Switching a bot to OpenID Connect **permanently turns off that bot's legacy Login Widget**. If you also want the Login Widget, create a second bot for OIDC now ([Create a bot](#create-a-bot)) and use it for the steps below.

1. **Open the settings.** Open BotFather's Mini App, select your bot, then select **Login Widget**.
2. **Switch the bot to OpenID Connect.** Tap **Switch to OpenID Connect Login** (the label on 2026-10-29). Telegram warns: "This action permanently disables the legacy login method." Confirm.
3. **Add your redirect URI.** Under **Redirect URIs**, tap **Add a Redirect URI**. This is the address Telegram sends users back to after they confirm. With Better Auth's default settings it is:

   ```text
   https://<your domain>/api/auth/callback/telegram-oidc
   ```

   For example `https://example.com/api/auth/callback/telegram-oidc`. It must match **exactly**, including `https://` and the path. If you changed Better Auth's `basePath`, replace `/api/auth` with it. BotFather rejects `localhost` addresses (both `http` and `https`), so use your tunnel's address during development.
4. **Trusted Origins: optional.** BotFather describes this list as "Allowed origins for cross-origin token requests". You only need it if your web page talks to Telegram's token endpoint itself (Telegram's browser login library). The plugin's sign-in exchanges the code on your server, and it worked in our live test with this list empty. Telegram's guide also mentions registering your site's origin, so adding `https://example.com` does no harm.
5. **Copy the Client ID and Client Secret.** BotFather shows both on this page. The Client ID is the bot's numeric ID (the part of the bot token before the `:`). The Client Secret is a separate value. **It is not the bot token.**
6. **Check the signing algorithm.** Under **Login Widget** > **Advanced**, leave the signing algorithm on **RS256** (the default) or pick **ES256**. With **EdDSA** or **ES256K**, Telegram leaves the user's ID, name and username out of the ID token, and the plugin can't verify ES256K at all.

Put the keys in your server's environment:

```bash
TELEGRAM_OIDC_CLIENT_ID="1234567890"
TELEGRAM_OIDC_CLIENT_SECRET="the Client Secret from BotFather"
```

Next: [OIDC guide](./oidc.md).

## Using more than one method

How many bots do you need?

| Methods you use | Bots | Plugin options |
|---|---|---|
| Login Widget only | 1 | `botToken`, `botUsername` |
| Mini App only | 1 | `botToken`, `miniApp.enabled`, `loginWidget: false` |
| OIDC only | 1 | `oidc.clientId`, `oidc.clientSecret`, `loginWidget: false` |
| Login Widget + Mini App | 1 | `botToken`, `botUsername`, `miniApp.enabled` |
| Mini App + OIDC | 1 or 2 | `botToken`, `miniApp.enabled`, `oidc`, `loginWidget: false` |
| Login Widget + OIDC (with or without a Mini App) | **2** | Bot A (widget, Mini App): `botToken`, `botUsername`. Bot B (OIDC): `oidc.clientId`, `oidc.clientSecret` |

Why: the plugin checks Login Widget and Mini App data with one bot token (`botToken`), so those two must share a bot. Switching to OpenID Connect only disables the Login Widget, so a Mini App can share a bot with OIDC. If `oidc.clientId` is left out, the plugin uses the bot ID from `botToken`.

The plugin logs a warning at startup when the Login Widget and OIDC are both enabled without a separate `oidc.clientId` (or with the widget bot's ID as `oidc.clientId`).

> **Stick with one OIDC bot.** Telegram gives the same person a different `sub` for each bot, and the plugin stores OIDC accounts by `sub`. If you switch OIDC to another bot, every OIDC user gets a new, empty account on their next sign-in.

## Changing the bot token later

If your bot token leaks, get a new one from BotFather right away. Plan for these effects:

- **BotFather creates the new token by revoking the old one**, so there is no period when both work. Update `TELEGRAM_BOT_TOKEN` and redeploy as soon as you have it.
- The token is also the key Telegram signs Login Widget and Mini App data with. Data signed with the old token is rejected (401). Users sign in again, and a Mini App opened before the switch must be closed and reopened.
- OIDC doesn't use the bot token, so OIDC sign-ins are not affected.

## Telegram's test environment

Telegram runs a separate [test environment](https://core.telegram.org/bots/webapps#testing-mini-apps) with its own user accounts and bots. A test-environment bot token works with the plugin like any other token. In the test environment you may also use plain HTTP links for Mini Apps.

The plugin's `testMode: true` option is only a label: `GET /telegram/config` returns it so your client can tell which environment it talks to. It changes nothing else. Telegram documents no test version of the Login Widget or of OIDC (`oauth.telegram.org`), so the plugin logs a warning if you combine `testMode` with OIDC.
