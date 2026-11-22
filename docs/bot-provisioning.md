# Bot provisioning (server only)

This is **not** a browser sign-in method. It lets trusted server code create or resolve a Better Auth user from a Telegram ID that your bot already proved, then use OIDC to sign that user in. Use it when your bot receives a Telegram update (for example through a webhook or long polling) and needs a local user ID before the user ever opens your website.

The name refers to the source of the verified update — your Telegram bot — not a call made by this plugin. The plugin never talks to Telegram in this flow; it trusts the ID your code has already proved.

The feature is **off by default**. With no `botProvisioning` option, nothing described here is registered, and existing setups behave exactly as before.

## Enable it

```ts
import { telegram } from "better-auth-telegram";

export const telegramPlugin = telegram({
  botProvisioning: true,
  loginWidget: false, // optional; keep the widget if you use it on another bot
  oidc: { enabled: true, clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET },
});
```

`botProvisioning: true` adds one server-only operation, `auth.api.provisionTelegramUser`, and makes the plugin add the same five optional Telegram columns that the Login Widget and Mini App use. Call the operation from your own trusted server code:

```ts
const { userId } = await auth.api.provisionTelegramUser({
  body: {
    telegramId: 8_306_595_751, // number, from the verified Telegram update
    firstName: "Ada",
    lastName: "Lovelace", // optional
    username: "ada", // optional, 1-32 letters/digits/underscores
  },
});
```

It returns `{ userId }` and **does not create a session**. The call is idempotent by Telegram ID: repeating it for the same user returns the same ID, without overwriting their name. It respects `autoCreateUser`: with `false`, an unknown Telegram user is refused instead of created. Your `databaseHooks` and `user.validateUserInfo` still run; the latter sees `source.method: "telegram-bot-provisioning"`.

The endpoint is pathless and marked `SERVER_ONLY`, so Better Auth does not create an HTTP route for it. A call that carries a `Request` is refused with 403.

## You own the trust boundary

**The plugin does not verify the Telegram update or authenticate the caller.** It receives an asserted Telegram ID and name and provisions that identity. Before calling it, your bot must verify the update came from Telegram, and your host must authenticate the service that calls `provisionTelegramUser` (for example, a shared secret held in your secret manager). Do not put this call behind an unauthenticated route. `SERVER_ONLY` stops Better Auth from exposing the endpoint; it is not caller authentication.

## Protect OIDC linking

If you also use OIDC, a signed-in user could otherwise attach the `telegram-oidc` identity of a user already provisioned from a bot update. Install the exported validator to refuse that:

```ts
import { telegram, validateTelegramBotOwnership } from "better-auth-telegram";

const auth = betterAuth({
  user: { validateUserInfo: validateTelegramBotOwnership },
  plugins: [telegramPlugin],
});
```

It applies only to OIDC `link-account` requests whose verified Telegram ID belongs to another user. It does not change ordinary sign-in, and it is **not** installed automatically when `botProvisioning: true`. If your app already has a `user.validateUserInfo` function, compose both checks in one function yourself; Better Auth accepts a single validator.

## Database and upgrading

Enabling `botProvisioning` activates the existing optional columns `user.telegramId`, `user.telegramUsername`, `user.telegramPhoneNumber`, `account.telegramId` and `account.telegramUsername`. If your app was OIDC-only (`loginWidget: false`, no Mini App), it had no columns: run `npx auth@1.7.17 migrate` before starting the new build. No new columns are added, so no data is rewritten. Disabling the feature later does not remove them.

## The whole flow

```ts
// 1. Your bot verifies the update came from Telegram (your code, not the plugin).
// 2. Your HTTP endpoint authenticates the calling bot service (your code).
// 3. Only then does the plugin provision the user:
const { userId } = await auth.api.provisionTelegramUser({
  body: {
    telegramId: sender.id,
    firstName: sender.first_name,
    lastName: sender.last_name,
    username: sender.username,
  },
});
// 4. Later, the user signs in with OIDC as usual and gets the same userId.
```

Steps 1 and 2 are the host's responsibility. Skipping them lets anyone claim any Telegram ID.

## Limits

- Provisioning locks are per Better Auth instance, not distributed. The Telegram columns are not a database-wide uniqueness constraint. If several servers can provision the same new ID simultaneously, test that boundary in your deployment.
- No session, cookie or bot token is returned or needed by the caller. Keep the bot token on the server as usual.
- Rate limits apply to Better Auth's HTTP routes; this pathless operation has none. Limit calls at your own boundary.
