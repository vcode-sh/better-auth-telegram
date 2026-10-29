# better-auth-telegram documentation

Welcome. This page tells you where to find each answer, and explains the words the other pages use. If you haven't installed anything yet, start with the [quick start in the main README](../README.md#quick-start-about-10-minutes).

## Which page answers my question?

| Your question | Page |
|---|---|
| Which sign-in method fits my app? | [Main README: decision guide](../README.md#which-sign-in-method-should-i-use) |
| How do I create the bot and fill in BotFather? | [Telegram bot setup](./telegram-bot-setup.md) |
| How do I install the plugin, set up the database and develop locally? | [Installation](./installation.md) |
| How do I show the Login Widget, link or unlink Telegram, handle errors? | [Usage](./usage.md) |
| How do I sign in with OIDC, get phone numbers, link OIDC to an existing user? | [OIDC](./oidc.md) |
| How do I sign users in inside a Mini App? Why are there no cookies in Telegram Web? | [Mini Apps](./miniapps.md) |
| What does option X do, and what is its default? | [Configuration](./configuration.md) |
| What does the plugin check, and what can it *not* protect against? | [Security](./security.md) |
| I get an error, or something doesn't happen. | [Troubleshooting](./troubleshooting.md) (organized by symptom) |
| What exactly does endpoint, type or error code X look like? | [API reference](./api-reference.md) |
| I'm on v2. What changes, and what do I do? | [Migration from v2 to v3](./migration-v2-to-v3.md) |

## Glossary

**Better Auth.** A TypeScript library that handles sign-in, sessions and users for your app. This package is a *plugin* for it: it adds Telegram as a way to sign in. See [better-auth.com](https://www.better-auth.com).

**Server plugin and client plugin.** `telegram()` (from `better-auth-telegram`) runs on your server and checks every sign-in. `telegramClient()` (from `better-auth-telegram/client`) runs in the browser and gives you helpers such as `signInWithTelegram()`.

**Bot.** An automated Telegram account that your app controls. All three sign-in methods go through a bot: users see its name and picture when they confirm the sign-in.

**BotFather.** Telegram's official bot for creating and configuring bots: [@BotFather](https://t.me/botfather). You can chat with it using commands like `/newbot`, or open it as a Mini App for a menu-based interface.

**Bot token.** The secret key of your bot, for example `110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`. Anyone who has it controls your bot. The plugin uses it on the server to check Login Widget and Mini App sign-ins. Never send it to the browser.

**Login Widget.** Telegram's "Log in with Telegram" button that you embed in a web page. Telegram now calls it the *legacy* widget. It still works and no shutdown date has been announced.

**Mini App.** A web app that opens inside the Telegram app (formerly "Web App"). It runs your website in a Telegram window.

**initData.** A signed text string that Telegram gives a Mini App when it opens. It says which Telegram user opened the app. The plugin checks its signature before trusting it.

**OIDC (OpenID Connect).** The standard "Sign in with..." flow used by Google, Apple and others, built on OAuth 2.0. Your site sends the user to Telegram's login page (`oauth.telegram.org`), the user confirms, and Telegram sends them back with a code your server exchanges for user details. Telegram calls this "Log In With Telegram".

**ID token.** A signed message (a JWT) from Telegram that describes the user in the OIDC flow. The plugin checks its signature before using anything in it. Telegram's ID tokens expire after 30 seconds.

**`sub` and `id`.** Two different identifiers in a Telegram ID token. `sub` is a user identifier that is different for each bot. `id` is the real Telegram user ID, the same number the Login Widget and Mini Apps use. Telegram sends `id` as a string.

**Client ID and Client Secret.** The two OIDC keys BotFather shows after you switch a bot to OpenID Connect. The Client ID is the bot's numeric ID. The Client Secret is *not* the bot token.

**Placeholder email.** Better Auth requires every user to have an email address, but Telegram never shares one. So the plugin gives new Telegram users an address like `8306595751@telegram.placeholder.invalid`. The `.invalid` ending is reserved (RFC 6761), so no email can ever be delivered there. The address is marked unverified and is reserved for Telegram sign-in.

**User and account.** In Better Auth, a *user* is a person. An *account* is one way that person can sign in (a password, Google, Telegram...). One user can have several accounts. The Login Widget and Mini App create accounts with provider ID `telegram`; OIDC creates accounts with provider ID `telegram-oidc`.

**Linking.** Adding another account (sign-in method) to a user who already exists, for example a user who signed up with email and later adds Telegram.

**Session.** Proof that a browser is signed in, usually a cookie set by Better Auth after a successful sign-in.

**Trusted origins.** The websites Better Auth accepts sign-in requests from. Your `BETTER_AUTH_URL` is trusted automatically; add others with Better Auth's `trustedOrigins` option.

**HMAC / signature.** A cryptographic check that proves data was created by someone who knows a secret. Telegram signs Login Widget data and Mini App `initData` with a key derived from your bot token, so only Telegram (and you) can produce valid data.

**Tunnel.** A tool such as [ngrok](https://ngrok.com) that gives your local development server a public HTTPS address. Telegram doesn't accept `localhost`, so you need one during development.

**Migration (database).** Changing your database tables to match what your code expects. Better Auth's CLI does this for you: `npx auth@latest migrate` or `npx auth@latest generate`.

## Links

- [GitHub repository](https://github.com/vcode-sh/better-auth-telegram) · [npm package](https://www.npmjs.com/package/better-auth-telegram) · [Changelog](../CHANGELOG.md)
- [Better Auth documentation](https://www.better-auth.com/docs)
- Telegram: [Log In With Telegram (OIDC)](https://core.telegram.org/bots/telegram-login) · [Login Widget (legacy)](https://core.telegram.org/widgets/login-legacy) · [Mini Apps](https://core.telegram.org/bots/webapps) · [Bot features and BotFather](https://core.telegram.org/bots/features)
