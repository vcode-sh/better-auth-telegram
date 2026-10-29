# Migrating from v2 to v3

This guide takes you from `better-auth-telegram` v2.x to v3. Most apps need four changes: newer Better Auth, a database update, the OIDC Client Secret (if you use OIDC), and a look at your hooks and unlink UI. The checklist below covers everything in order; each step says who it applies to, so you can skip what doesn't concern you.

## Contents

- [Why upgrade](#why-upgrade)
- [Before you start](#before-you-start)
- [Upgrade checklist](#upgrade-checklist)
- [All breaking changes](#all-breaking-changes)
- [Check that the upgrade worked](#check-that-the-upgrade-worked)
- [Rolling back](#rolling-back)
- [FAQ](#faq)

## Why upgrade

**v3 is the only version that works with a Better Auth release that has the current security fixes.**

v2 requires Better Auth 1.6. Better Auth 1.6 is affected by [GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm), a critical account-takeover issue (CVSS 9.1): in Better Auth from 1.4.0-beta.18 up to (not including) 1.7.7, an OAuth sign-in `state` value could be used as a Magic Link token, letting an attacker who knows a user's email sign in as that user. It affects apps that use Magic Link together with a social or OAuth sign-in (such as Telegram OIDC), with OAuth state stored in the database (the default when you have a database). It is fixed **only in 1.7.7**; there is no 1.6 fix, and Better Auth supports only its latest version.

v3 therefore requires Better Auth **1.7.12 or newer** (below 1.8). 1.7.12 is the first release in which every OAuth callback route, including Better Auth's `oauth-proxy` plugin, checks the ID-token nonce.

v3 also fixes real bugs (Login Widget and Mini App sign-up failed on SQL databases, OIDC ID tokens weren't verified on the callback, unlinking didn't stop Telegram sign-in) and brings stricter, Better-Auth-consistent rules. The [changelog](../CHANGELOG.md) lists every change.

## Before you start

- **Node.js 22 or newer.** Check with `node --version`. (v2 required Node.js 24, so this can only get easier.)
- **Read Better Auth's own [1.7 upgrade guide](https://www.better-auth.com/docs/guides/1-7-upgrade-guide).** Moving from Better Auth 1.6 to 1.7 has its own changes, independent of this plugin. Do both upgrades together.
- **Back up your database.** The plugin's changes are additive (one new index), but Better Auth's 1.7 migration may change more.
- **Try it outside production first**, with your real database adapter.

## Upgrade checklist

### 1. Update the packages (everyone)

```bash
npm install better-auth-telegram better-auth@1.7
```

`better-auth@1.7` installs the newest 1.7.x release. If your `package.json` also lists `@better-auth/core` directly, update it to the same version:

```bash
npm install @better-auth/core@1.7
```

Check the result: `npm ls better-auth-telegram better-auth @better-auth/core` should show `better-auth-telegram` 3.x and Better Auth 1.7.12 or newer, all Better Auth packages on the same version.

### 2. Apply Better Auth's own 1.7 changes (everyone)

Follow the [Better Auth 1.7 upgrade guide](https://www.better-auth.com/docs/guides/1-7-upgrade-guide) for the parts that apply to your app.

### 3. Update the database (everyone)

```bash
npx auth@latest migrate        # built-in Kysely adapter (pg, mysql2, SQLite)
npx auth@latest generate       # Prisma or Drizzle; then run your ORM's migration
npx auth@latest check schema   # must print "Schema check passed against the live database."
```

Why: Better Auth 1.7.3 and newer answers **every** request with HTTP 500 until the database matches the schema. v3 adds an index on `user.telegramId` (it makes every Login Widget and Mini App sign-in faster). The five Telegram columns are the same as in v2.

Prisma users who write the schema by hand add the index:

```diff
 model User {
   telegramId          String?
   telegramUsername    String?
   telegramPhoneNumber String?
+
+  @@index([telegramId])
 }
```

### 4. OIDC: set the Client Secret (OIDC users)

`oidc.clientSecret` is now required. v2 fell back to the bot token, which Telegram never accepted, so OIDC never worked without it.

```diff
 telegram({
   botToken: process.env.TELEGRAM_BOT_TOKEN,
   botUsername: process.env.TELEGRAM_BOT_USERNAME,
   oidc: {
     enabled: true,
+    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
+    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
   },
 });
```

Get both from BotFather's Mini App: your bot > **Login Widget** (older docs called this page "Web Login"). See [Telegram bot setup: OIDC](./telegram-bot-setup.md#oidc).

**Login Widget and OIDC on the same bot?** That can't work: switching a bot to OpenID Connect permanently turns off its Login Widget. v3 warns at startup. Move OIDC to a second bot (`oidc.clientId` + `oidc.clientSecret` of that bot), or turn the widget off with `loginWidget: false`.

### 5. OIDC: the `id` claim is a string (OIDC users with TypeScript code that reads it)

`TelegramOIDCClaims.id` was typed `number`; Telegram actually sends a string.

```diff
 mapOIDCProfileToUser: (claims) => {
-  const telegramId: number = claims.id;
+  const telegramId: string | undefined = claims.id;
   ...
 }
```

### 6. OIDC: remove Telegram fields from `mapOIDCProfileToUser` (OIDC users)

Returning `telegramId`, `telegramUsername` or `telegramPhoneNumber` never worked: Better Auth drops fields that users may not set. v3 fills them itself (when the Login Widget or Mini App is enabled).

```diff
 mapOIDCProfileToUser: (claims) => ({
   name: claims.name,
-  telegramId: String(claims.id),
-  telegramPhoneNumber: claims.phone_number,
 }),
```

### 7. OIDC: check `scopes` (OIDC users who set `oidc.scopes`)

`oidc.scopes` now **adds** to the defaults (`openid`, `profile`), like Better Auth's built-in providers. In v2 it replaced `profile`, so `scopes: ["phone"]` silently lost the Telegram ID, name and username.

```diff
 oidc: {
   enabled: true,
   clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
-  scopes: ["openid", "profile", "phone"],
+  requestPhone: true,
 },
```

Your old list still works (each scope is sent once). If you meant to drop `profile`, use `disableDefaultScope: true`.

### 8. OIDC: send the nonce with client-side ID tokens (only if you call `/sign-in/social` with `idToken`)

```diff
 await authClient.signIn.social({
   provider: "telegram-oidc",
-  idToken: { token },
+  idToken: { token, nonce },
 });
```

Tokens without their nonce are refused with 401. Don't use this path? Turn it off with `oidc.disableIdTokenSignIn: true`.

### 9. Review your mappers (if you use `mapTelegramDataToUser` or `mapMiniAppDataToUser`)

Mapper output is now **merged over the defaults** and filtered like a Better Auth OAuth profile:

- Return only what you want to change. In v2, leaving out `name` or `image` lost the default.
- `id` and `emailVerified` are ignored; emails from mappers are always unverified.
- Fields that aren't in your user schema, or are `input: false`, are dropped. Declare custom fields in Better Auth's `user.additionalFields`.
- An email another user already has gives 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (v2: a 500 on SQL databases).

```diff
 mapTelegramDataToUser: (data) => ({
   name: data.username ?? data.first_name,
-  image: data.photo_url,          // no longer needed: it's the default
-  emailVerified: true,            // ignored now
 }),
```

### 10. Review your hooks (if you use `databaseHooks` or `user.validateUserInfo`)

In v2, Login Widget and Mini App sign-ups wrote to the database directly, so your hooks never saw them. In v3 they go through Better Auth:

- `databaseHooks` run for Telegram users, accounts and sessions. A `user.create.before` hook that returns `false` now blocks Telegram sign-ups (403 `USER_CREATION_REJECTED`).
- `user.validateUserInfo` now runs for Login Widget and Mini App sign-ups (`"create-user"`), returning users (`"sign-in"`) and links (`"link-account"`), with `source.method` `"telegram-login-widget"` or `"telegram-mini-app"`. If it throws, the request fails with 403.

Make sure your hooks expect Telegram users, for example users with a placeholder email:

```ts
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  user: {
    validateUserInfo: ({ user, source }) => {
      const isTelegram =
        source.method === "telegram-login-widget" ||
        source.method === "telegram-mini-app";
      // Example policy: email domain checks don't apply to Telegram users
      if (!(isTelegram || String(user.email ?? "").endsWith("@example.com"))) {
        return { error: "email_domain_not_allowed" };
      }
    },
  },
});
```

### 11. Check your account-linking settings (if you set `account.accountLinking`)

The plugin now follows Better Auth's settings:

- `account.accountLinking.enabled: false` turns off `/telegram/link` (403 `LINKING_DISABLED`).
- With `enabled: false` or `disableImplicitLinking: true`, a Login Widget or Mini App sign-in that would link itself to an existing user by `telegramId` (for example a user who signed up with OIDC) answers 401 `ACCOUNT_NOT_LINKED` instead.

New users and returning Telegram users are not affected.

### 12. Update your unlink UI (if you offer "unlink Telegram")

`/telegram/unlink` now has two new answers. Before, your code probably looked like this:

```ts
const { error } = await authClient.unlinkTelegram();
if (error) {
  showError(error.message);
}
```

After, handle the two new cases with a helpful message:

```ts
import { authClient } from "./auth-client";

export async function unlinkTelegramV3(showError: (message: string) => void) {
  const { error } = await authClient.unlinkTelegram();
  if (error?.code === "CANNOT_UNLINK_LAST_ACCOUNT") {
    // 400: Telegram is the only way in.
    showError("Add another way to sign in before removing Telegram.");
  } else if (error?.code === "SESSION_NOT_FRESH") {
    // 403: the session is older than session.freshAge (1 day by default).
    showError("Please sign in again, then remove Telegram.");
  } else if (error) {
    showError(error.message ?? "Could not remove Telegram.");
  }
}
```

Also new: linking a second, different Telegram account to a user answers 409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`.

### 13. Sign-in pages on another origin (if your login page or Mini App isn't on `BETTER_AUTH_URL`)

`/telegram/signin` and `/telegram/miniapp/signin` now refuse browser requests from untrusted origins (403 `INVALID_ORIGIN`), even without cookies. Add those origins to `trustedOrigins`:

```diff
 betterAuth({
+  trustedOrigins: ["https://app.example.com"],
   plugins: [telegram({ /* ... */ })],
 });
```

### 14. Optional clean-ups

These still work, but you can remove them:

- **Page reloads after sign-in, link or unlink.** The client now refreshes `useSession()` itself.
- **`fetchOptions: { credentials: "include" }`** in `createAuthClient`. Better Auth's client already sends it.
- **Hand-written error strings.** Compare with `TELEGRAM_ERROR_CODES` from `better-auth-telegram/client` instead.
- **Manual widget cleanup** (`container.innerHTML = ""`). `initTelegramWidget` now returns a handle with `destroy()`, and accepts an element as well as an id.

## All breaking changes

| What changed | What breaks | What to do |
|---|---|---|
| Better Auth `>=1.7.12 <1.8.0` (was `>=1.6.22 <1.7.0`); `@better-auth/core` is now a peer too | Installing next to Better Auth 1.6 fails | [Step 1](#1-update-the-packages-everyone), [step 2](#2-apply-better-auths-own-17-changes-everyone) |
| Better Auth checks the schema; `user.telegramId` is indexed | Every request answers 500 until migrated | [Step 3](#3-update-the-database-everyone) |
| Login Widget and Mini App go through Better Auth's internal adapter | Your `databaseHooks` and `user.validateUserInfo` now see Telegram users, and can block them | [Step 10](#10-review-your-hooks-if-you-use-databasehooks-or-uservalidateuserinfo) |
| `/telegram/unlink` needs a fresh session and keeps the last sign-in method | New 403 `SESSION_NOT_FRESH` and 400 `CANNOT_UNLINK_LAST_ACCOUNT` | [Step 12](#12-update-your-unlink-ui-if-you-offer-unlink-telegram) |
| One Telegram identity per user | Linking a different Telegram account answers 409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED` | Unlink the old one first |
| Better Auth's account-linking settings apply | 403 `LINKING_DISABLED` / 401 `ACCOUNT_NOT_LINKED` with those settings | [Step 11](#11-check-your-account-linking-settings-if-you-set-accountaccountlinking) |
| Login CSRF protection on sign-in | 403 `INVALID_ORIGIN` for untrusted origins | [Step 13](#13-sign-in-pages-on-another-origin-if-your-login-page-or-mini-app-isnt-on-better_auth_url) |
| `oidc.clientSecret` required, no bot-token fallback | OIDC sign-in answers 500 `OIDC_CLIENT_SECRET_REQUIRED` | [Step 4](#4-oidc-set-the-client-secret-oidc-users) |
| Client-submitted ID tokens need their nonce | ID-token sign-in without `nonce` answers 401 | [Step 8](#8-oidc-send-the-nonce-with-client-side-id-tokens-only-if-you-call-sign-insocial-with-idtoken) |
| Mappers merge over the defaults | Nothing breaks; omitted `name` / `image` now keep their default | [Step 9](#9-review-your-mappers-if-you-use-maptelegramdatatouser-or-mapminiappdatatouser) |
| Mapper output is filtered like an OAuth profile | Mappers can't set `id`, `emailVerified`, unknown or `input: false` fields; a taken email answers 422 | [Step 9](#9-review-your-mappers-if-you-use-maptelegramdatatouser-or-mapminiappdatatouser) |
| `oidc.scopes` adds to `openid` + `profile` | Requests now include `profile` even if your list didn't | [Step 7](#7-oidc-check-scopes-oidc-users-who-set-oidcscopes) |
| Sign-in responses are filtered like Better Auth's | Fields marked `returned: false` no longer appear in `/telegram/signin` and `/telegram/miniapp/signin` responses | Read them on the server if you need them |
| `TelegramOIDCClaims.id` is `string` | TypeScript errors where code expects a number | [Step 5](#5-oidc-the-id-claim-is-a-string-oidc-users-with-typescript-code-that-reads-it) |
| New OIDC users get `<sub>@telegram-oidc.placeholder.invalid` (was `<sub>@telegram.oidc`) | Code that recognizes the old domain misses new users | Check for both domains, or for `.placeholder.invalid` and `@telegram.oidc` |
| New Login Widget / Mini App users get `<telegram id>@telegram.placeholder.invalid` (v2 sent no email) | Nothing, unless code expects these users to have no email | Treat `.placeholder.invalid` as "no email" |
| Placeholder emails are reserved | Other sign-ups with those addresses are refused; changing an email to one answers 400 `PLACEHOLDER_EMAIL_RESERVED` | Nothing, unless you relied on it |
| Build: tsdown instead of tsup, TypeScript 7; `jose` is a dependency instead of bundled | Nothing for most apps | None |

## Check that the upgrade worked

1. `npm ls better-auth-telegram better-auth` shows 3.x and 1.7.12 or newer.
2. `npx auth@latest check schema` prints `Schema check passed against the live database.`
3. The server starts without `[better-auth-telegram]` warnings ([what they mean](./configuration.md#startup-warnings)).
4. `GET /api/auth/telegram/config` lists the methods you expect as enabled.
5. Sign in once with each method you use. A **new** Telegram user gets an email ending in `.placeholder.invalid`; existing users keep theirs.
6. If you use linking: link and unlink Telegram on a test user that also has a password. Afterwards, that user's `telegramId` is empty.
7. If you use OIDC: sign in and check that the user got `telegramId` (when the Login Widget or Mini App is enabled).

## Rolling back

If something goes wrong and you need to go back to v2:

```bash
npm install better-auth-telegram@2 better-auth@1.6
```

What to know first:

- **Rolling back means running Better Auth 1.6, which has the critical issue described in [Why upgrade](#why-upgrade)**, and also [GHSA-r4xp-prcw-77qf](https://github.com/better-auth/better-auth/security/advisories/GHSA-r4xp-prcw-77qf) if you use Better Auth's `oauth-proxy` plugin. There is no fixed 1.6 release. If you must roll back, apply the workarounds listed in each advisory while you fix forward (they include switching off Magic Link sign-in; read them in full, because one of them interacts with `oauth-proxy`), and treat it as a short-term measure.
- **The plugin's database changes don't need undoing.** The columns are the same in v2 and v3; the extra index is harmless. Undo Better Auth's own 1.7 migration according to Better Auth's guidance.
- **Users created by v3 use the same tables and account IDs as v2** (`telegram` accounts by Telegram ID, `telegram-oidc` accounts by `sub`). To v2, their placeholder emails are ordinary values.

## FAQ

**Do I have to change my users' data?**
No. Existing users keep their emails, accounts and Telegram IDs. The only database change is the new index.

**Will my existing OIDC users get new accounts?**
No. v3 still identifies OIDC accounts by `sub`, exactly like v2. (Changing the OIDC *bot* would give them new accounts, because `sub` differs per bot. That was true in v2 as well.)

**My OIDC users still have `@telegram.oidc` emails. Should I change them?**
You don't have to. Only new OIDC users get the new placeholder domain. Note that the reservation that stops other sign-ups from claiming placeholder addresses covers only the new `.placeholder.invalid` domains.

**Do my v2 OIDC users get a `telegramId` now?**
Yes, on their next OIDC sign-in, if the Login Widget or Mini App is enabled (so the column exists) and the bot signs with RS256 or ES256. Until then, their OIDC account doesn't count as proof of a Telegram ID when another Telegram account is unlinked.

**I use only the Login Widget and no hooks. What's the minimum?**
Steps 1, 2 and 3, then step 12 if you offer an unlink button.

**Why did my `validateUserInfo` start rejecting Telegram users?**
In v2 it was never called for Login Widget and Mini App users. Now it is, with `source.method` `"telegram-login-widget"` or `"telegram-mini-app"`. See [step 10](#10-review-your-hooks-if-you-use-databasehooks-or-uservalidateuserinfo).

**A user unlinked Telegram. What happens if they sign in with it again?**
They get a new user. The old user keeps its placeholder email, so the new one gets another reserved placeholder (`<telegramId>.<random>@telegram.placeholder.invalid`). Unlinking really separates the two.

**Is anything faster or simpler now?**
Yes: `useSession()` updates by itself after Telegram sign-in, link and unlink; error codes are typed and exported; the widget helpers return `destroy()`; `session.user.telegramId` is typed on the server and client; and the plugin reports configuration mistakes at startup through Better Auth's logger.
