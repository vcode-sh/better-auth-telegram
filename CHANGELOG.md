# Changelog

All notable changes to the better-auth-telegram plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-10-30

### Added

- **`oidc.updateUserInfoOnSignIn`** ([#53](https://github.com/vcode-sh/better-auth-telegram/issues/53)) — writes `name`, `image` and the fields returned by `mapOIDCProfileToUser` onto returning users at every OIDC sign-in, not only when the user is created. It runs once Better Auth has allowed the sign-in (`validateUserInfo` included) and, unlike Better Auth's `overrideUserInfoOnSignIn`, never touches the email or `emailVerified`. If the update fails (a hook refuses it, or a field validator rejects a mapped value), a warning is logged and the sign-in continues with the stored profile.
- **Startup warning for `oidc.overrideUserInfoOnSignIn`** — the option was removed in 3.0.0 and has been ignored silently since.

### Fixed

- **OIDC sessions lacked the Telegram identity** — the plugin copies `telegramId`, `telegramUsername` and `telegramPhoneNumber` onto the user after Better Auth has read it to issue the session. With `session.cookieCache`, the first OIDC session served the user without them until the cache expired; in stateless mode (no database) it never got them; the `/sign-in/social` ID token response lacked them too. A returning user's changed username or phone number, and the first OIDC sign-in that links an existing user by email, had the same delay. When the plugin changed the signed-in user, it now issues the session cookie (and `newSession`, and the ID token response's `user`) again with the stored user, like Better Auth's `/update-user`. A session cookie an earlier after hook removed stays removed. Keep framework cookie plugins such as `nextCookies()` last in `plugins`, as Better Auth requires.

Thanks to @parmetra for [#53](https://github.com/vcode-sh/better-auth-telegram/issues/53): decoding the session JWT after an OIDC sign-in is what exposed both problems.

## [3.0.0] - 2026-10-29

Better Auth 1.7 support. Stable release under the npm dist-tag `latest`.

### Breaking

- **Better Auth `>=1.7.12 <1.8.0`** ([#47](https://github.com/vcode-sh/better-auth-telegram/issues/47)) — `better-auth` and `@better-auth/core` are peer dependencies with this range. 1.6 is no longer supported: [GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm) (account takeover through Magic Link with social sign-in) is fixed only in 1.7.7, and Better Auth ships no 1.6 fix. The floor is 1.7.12 because earlier 1.7 releases let the `oauth-proxy` callback skip the ID token nonce. CI tests 1.7.12 and the locked 1.7.14.
- **Schema must match** — Better Auth 1.7.3+ rejects every auth request until the database schema matches. With the Login Widget or Mini App enabled, all five Telegram columns must exist; `user.telegramId` is now also indexed. Regenerate or migrate the schema (`npx auth@1.7.14 generate` / `migrate`, then `npx auth@1.7.14 check schema`).
- **Login Widget and Mini App users go through Better Auth's internal adapter** — `databaseHooks` apply to the users and accounts these flows create, and `user.validateUserInfo` sees sign-ups (`create-user`), returning sign-ins (`sign-in`) and links (`link-account`), with `source.method` `telegram-login-widget` or `telegram-mini-app`. Before, both were silently bypassed.
- **`/telegram/unlink` keeps the last sign-in method and needs a fresh session** — unlinking the only account answers 400 `CANNOT_UNLINK_LAST_ACCOUNT` unless `account.accountLinking.allowUnlinkingAll` is set, and like Better Auth's `/unlink-account` it requires a recent sign-in (403 `SESSION_NOT_FRESH`).
- **One Telegram identity per user** — `/telegram/link` with a different Telegram account than the one the user already has answers 409 `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`.
- **Better Auth's account linking settings apply** — with `account.accountLinking.enabled: false`, `/telegram/link` answers 403 `LINKING_DISABLED`. With `enabled: false` or `disableImplicitLinking: true`, a Login Widget or Mini App sign-in that would link itself to an existing user by `telegramId` (for example one created by OIDC) answers 401 `ACCOUNT_NOT_LINKED` instead, as Better Auth's own OAuth sign-in does. New users and returning Telegram users sign in as before.
- **Login CSRF protection on `/telegram/signin` and `/telegram/miniapp/signin`** — like Better Auth's `/sign-in/email`, a browser request from an origin that isn't in `trustedOrigins` gets 403 `INVALID_ORIGIN`, cookies or not. A Mini App served from another origin than your auth server needs that origin in `trustedOrigins` (it already did for any request carrying cookies). Requests without `Origin` and Fetch Metadata headers, such as server-to-server calls, are unaffected.
- **`oidc.clientSecret` is required** — the bot-token fallback is gone; Telegram never accepted it.
- **Client-submitted ID tokens need their nonce** — `POST /sign-in/social` / `/link-social` with `idToken` must include the `nonce` the token carries. This refuses tokens issued without one; it is not replay protection (a captured token is accepted until it expires, about a minute with clock tolerance). The path stays on by default, as for Better Auth's built-in providers; `oidc.disableIdTokenSignIn` turns it off.
- **Custom user mappers merge over the defaults** — `mapTelegramDataToUser` and `mapMiniAppDataToUser` no longer replace the default name and image when they omit them.
- **Mapper output is parsed like a Better Auth OAuth profile** — mappers (including `mapOIDCProfileToUser`) can no longer set the user `id` or `emailVerified` (Telegram verifies no email; a verified flag from a mapper let Better Auth link the Telegram user to an existing account with that email), and `input: false` or unknown fields are dropped, as on Better Auth's OAuth sign-up. A Login Widget or Mini App mapper email another user already has answers 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (before: a 500 on SQL databases). OIDC follows Better Auth's OAuth linking rules.
- **`oidc.scopes` adds to the defaults** — like Better Auth's built-in providers: `openid` and `profile` are always requested unless the new `oidc.disableDefaultScope` drops `profile`. Before, any `scopes` list replaced `profile`, so `scopes: ["phone"]` silently lost the Telegram id, names and username. Scopes are requested once each, including those passed to the sign-in request.
- **Sign-in responses are filtered like Better Auth's** — `/telegram/signin` and `/telegram/miniapp/signin` return `user` and `session` through Better Auth's output parsing, so `returned: false` fields no longer leak.
- **`TelegramOIDCClaims.id` is a `string`** — that is what Telegram sends (`"8306595751"`).
- **New OIDC users get `<sub>@telegram-oidc.placeholder.invalid`** instead of `<sub>@telegram.oidc`. Existing users keep their stored email.
- **Tooling** — built with tsdown instead of tsup, TypeScript 7. `jose` is now a dependency instead of being bundled into `dist`.

### Fixed

- **OIDC identity sync vetoes** — account/user updates are checked and synchronized in one adapter transaction. Refused writes stop sign-in before a new session is created, with `IDENTITY_UPDATE_REJECTED`; duplicate OIDC identities reach Better Auth's error redirect rather than an unhandled 500.
- **React examples** — each widget effect owns a separate host, so out-of-order initialization cannot remove the active button. The linking example recreates its button after unlink; the Mini App example preserves URL-parameter fallback when the SDK is unavailable.

- **Hook vetoes are respected** — a refused Telegram account creation or identity update returns 403, and `/telegram/unlink` reads back account removal before reporting success. A stale `user.telegramId` without a linked account no longer grants sign-in access. SQL transactions roll back rejected link/unlink changes.
- **Concurrent links to one user** — different Telegram identities are serialized by target user as well as Telegram ID within one Better Auth instance, so only one can link.
- **Supported Node.js floor** — `>=24.0.0`, tested explicitly in CI. Node 24 is the supported baseline; the exact minimum and current Node 24/26 releases run in CI.

- **OIDC on Better Auth 1.7** ([#46](https://github.com/vcode-sh/better-auth-telegram/pull/46)) — the provider implements `accountSubject` (the OIDC `sub`, so existing account ids are unchanged), the declarative `idToken` config that replaced `verifyIdToken`, and no longer returns `user.id`. Thanks to @sphr2k for the diagnosis.
- **Unlinking removes every `telegram` row** — duplicate rows (left by v2 or a race) kept proving `telegramId`, so an unlinked Telegram user could still sign in.
- **Signing up again after an unlink** — the old user keeps its placeholder email, so Login Widget, Mini App and OIDC sign-ins use a new reserved placeholder for a new user. OIDC no longer gets stuck at `account_not_linked` or relinks through the detached placeholder when email-based linking is enabled.
- **Login Widget and Mini App sign-up on SQL databases** — users were created without an email, which failed with `NOT NULL constraint failed: user.email` on every schema generated by Better Auth's CLI. They now get `<telegramId>@telegram.placeholder.invalid` (unverified) unless a mapper returns an email.
- **`/telegram/link` conflicts** — also answers 409 when another user's profile already has the Telegram id, not only when the account row exists.
- **Stale usernames** — every Login Widget, Mini App and OIDC sign-in refreshes the stored `telegramUsername`, and clears it once the Telegram user has none (OIDC: when the token carries profile claims but no `preferred_username`).
- **Concurrent first sign-ins** — two simultaneous first sign-ins of the same Telegram user (a double-submitted widget callback, React strict mode running the Mini App auto sign-in twice) created a second account row or answered 500 on a unique-email error. They are now handled one at a time per Better Auth instance, and a server that loses the race against another server signs in as the user that server created.
- **Session cookie cache after `/telegram/link` and `/telegram/unlink`** — both re-issue the session cookie, so `session.cookieCache` no longer serves the Telegram identity from before the change for up to `maxAge`.
- **Widget script loaded twice** when two widgets initialized at the same time (React strict mode).
- **`useSession` after Telegram sign-in, link and unlink** — the client actions (`signInWithTelegram`, `signInWithMiniApp`, `autoSignInFromMiniApp`, `linkTelegram`, `unlinkTelegram`) and the generated routes (`authClient.telegram.signin(...)`) now refresh the session store like Better Auth's own actions; before, the UI stayed signed out (or showed the old Telegram identity) until a reload.
- **Coded errors instead of empty 500s** — a missing `oidc.clientSecret` (or client id) answers 500 `OIDC_CLIENT_SECRET_REQUIRED` / `OIDC_CLIENT_ID_REQUIRED` with a message; a database hook vetoing the session answers 401 `FAILED_TO_CREATE_SESSION`, as `/sign-in/email` does.
- **`miniApp.validateInitData: false` no longer needs a bot token** for `/telegram/miniapp/signin` (nothing is verified with it there).
- **Duplicate Login Widget / Mini App account rows** left by older versions no longer break sign-in, and link/create writes run in a transaction. OIDC still rejects ambiguous account ownership; resolve its duplicate rows before upgrading.
- **`testMode` documentation** — it is informational (returned by `GET /telegram/config`) and never switched the widget to a test environment.

### Security

- **OIDC ID tokens are verified before their claims are used** ([#38](https://github.com/vcode-sh/better-auth-telegram/pull/38)) — signature against Telegram's JWKS (cached), issuer, audience (your client id and no other, as OpenID Connect Core §3.1.3.7 requires), expiry and a per-request nonce. The authorization-code path used to decode the token unverified. Thanks to @onhate for raising it.
- **HTTP Basic client authentication** at Telegram's token endpoint, as Telegram's docs require. Token errors that Telegram answers with HTTP 200 now surface as `invalid_code`.
- **Client-submitted ID tokens** (`POST /sign-in/social` with `idToken`) are verified like the redirect flow and only accepted with their nonce; `oidc.disableIdTokenSignIn` turns this path off. ES256K stays unsupported because Web Crypto cannot verify it.
- **Unlinking revokes Telegram sign-in** — `user.telegramId` (which the Login Widget and Mini App sign users in by) is re-checked whenever a `telegram` or `telegram-oidc` account is removed, by any route, and cleared or switched when no remaining account proves it.
- **Verified OIDC claims stay with their user** — they are applied only to the user who owns the OIDC account for that `sub`.
- **Placeholder emails are reserved** — other sign-up methods can no longer register (or switch to) `@telegram.placeholder.invalid` / `@telegram-oidc.placeholder.invalid` addresses to block or pre-claim a Telegram user. Changing an email to one now fails with 400 `PLACEHOLDER_EMAIL_RESERVED` instead of reporting success for a change that never happened.
- **Login Widget callbacks** — two widgets set up in the same millisecond no longer share one callback (a login on one ran the other's `onAuth`); a second login on the same page works; errors thrown by `onAuth` are logged instead of surfacing as unhandled rejections.
- **HMAC checks** compare in constant time, require a 64-character lowercase hex hash, reject `auth_date` values that are not integers or lie more than 60 seconds in the future, and reject Login Widget fields containing line breaks.
- **Startup warnings** for `miniApp.validateInitData: false` and for enabling the legacy Login Widget and OIDC on the same bot (switching a bot to OIDC in @BotFather permanently disables its legacy widget).

### Added

- **Inferred Telegram fields** — `session.user.telegramId`, `telegramUsername` and `telegramPhoneNumber` type-check on the server (`auth.$Infer.Session`, `auth.api.getSession`) and the client (`useSession`, `$Infer`). They are optional (`string | null | undefined`); in OIDC-only mode they exist in the types but are never set.
- **`TELEGRAM_ERROR_CODES`** exported from `better-auth-telegram` and `better-auth-telegram/client` (the client copy pulls in no server code), and as the client plugin's `$ERROR_CODES`. Client actions type `error.code` and their response `data` (`TelegramSignInResponse`, `TelegramLinkResponse`).
- **Widget helpers for components** — `initTelegramWidget` and `initTelegramWidgetRedirect` accept an element as well as an id and return `{ destroy() }`, which removes the widget, the iframe Telegram rendered and the global callback.
- **Startup diagnostics through Better Auth's logger** (they used `console.warn`): whitespace around `botToken` is trimmed with a warning, a token that isn't `<digits>:<secret>` is reported, a leading `@` in `botUsername` is stripped, the same-bot warning also catches `oidc.clientId` equal to the widget bot's id, and `oidc.requestPhone` without the Telegram columns (OIDC-only) warns that phone numbers won't be stored. `createTelegramOIDCProvider` takes an optional logger (the plugin passes Better Auth's).
- **Telegram identity on OIDC users** ([#25](https://github.com/vcode-sh/better-auth-telegram/issues/25)) — when the schema has the Telegram columns, OIDC sign-ups, sign-ins and links copy the verified `id`, `preferred_username` and `phone_number` claims to `telegramId`, `telegramUsername` and `telegramPhoneNumber`, so Login Widget and Mini App sign-ins find users that signed up with OIDC. The reverse direction is still open in #25.
- **Mini App types** — `signature`, `chat_join_request_query_id`, `user.added_to_attachment_menu`.
- **Login Widget script** `telegram-widget.js?24`.
- **Warning** when an OIDC ID token lacks profile claims (Telegram drops them for bots that sign with EdDSA or ES256K).
- **`oidc.disableIdTokenSignIn`, `oidc.disableSignUp` and `oidc.disableDefaultScope`** options. (`oidc.overrideUserInfoOnSignIn` is not exposed: Better Auth's override wrote the placeholder email over a real one.)
- **Error codes** `DIFFERENT_TELEGRAM_ACCOUNT_LINKED`, `CANNOT_UNLINK_LAST_ACCOUNT`, `USER_CREATION_REJECTED`, `ORPHANED_ACCOUNT`, `PLACEHOLDER_EMAIL_RESERVED`, `ACCOUNT_NOT_LINKED`.

### Changed

- Tests run against a real Better Auth instance (memory adapter and SQLite with Better Auth's own migrations) and a fake oauth.telegram.org modeled on live behavior; mock-only and existence-only tests were removed. An adapter lane (`npm run test:adapters`, its own CI job) runs the core flows on PostgreSQL and MySQL (Kysely), Drizzle and Prisma on PostgreSQL, and MongoDB. HMAC tests use literal vectors computed independently with openssl, including a real-shaped Mini App payload with `signature`. A compiled consumer type test checks the published declarations.
- CI uses one required `CI` gate covering Node 24.0.0, current Node 24/26, the complete Better Auth 1.7.12 family, Bun 1.4.4, real database adapters, lint, types, runtime audit and an installed package consumer. Redundant PR and beta lanes are removed. Actions use immutable commits; Dependabot auto-merge is limited to patch/minor development tools, with the Better Auth family, runtime dependencies and Actions kept for review.
- **`engines.node` stays `>=24`**, matching v2.0.1. CI tests the exact minimum and current Node 24/26 releases.
- Release tags must match the package version and belong to `main`. Read-only validation builds and tests a tarball, a separate OIDC job publishes that exact tarball with provenance, and a separate job creates the GitHub Release. Prereleases publish to `next`; stable releases use `latest`.

## [2.0.1] - 2026-07-29

### Changed

- **Node.js 24 baseline** — package metadata, local version selection, and CI now target Node.js 24.
- **Development tooling** — updated Biome to 2.4.6, lint-staged to 17.2.0, and Ultracite to 7.5.9 after verifying the full lint, test, type-check, and build pipeline.

## [2.0.0] - 2026-07-29

### Added

- **Mini App launch-parameter fallback** ([#26](https://github.com/vcode-sh/better-auth-telegram/issues/26)) — `autoSignInFromMiniApp()` now prefers the Telegram SDK's `initData` and falls back to `tgWebAppData` from the URL fragment when the SDK object is unavailable.
- **Current Telegram OIDC claim types** — `TelegramOIDCClaims` now includes optional `id`, `given_name`, `family_name`, and `phone_number_verified` claims.

### Fixed

- **Flow-aware credentials** ([#19](https://github.com/vcode-sh/better-auth-telegram/pull/19)) — `botToken` and `botUsername` no longer abort plugin initialization when their flows are disabled or secrets are injected later. Enabled flows warn during setup and reject at the request boundary if a required credential is still missing.
- **OIDC algorithm validation** — ID-token verification now allows Telegram's documented `RS256`, `ES256`, and `EdDSA` algorithms, rejects unsupported algorithms before fetching JWKS, and requires the selected JWK algorithm to match the token header.

### Changed

- **Dependency security floor** — the Better Auth peer range is now `>=1.6.22 <1.7.0`, and affected development dependencies were updated to patched versions. This is a breaking requirement for projects still using Better Auth 1.5 or older 1.6 releases.
- Test count: 261 → 344. The new coverage focuses on credential boundaries, Mini App launch data, current OIDC claims, and supported signing algorithms.

### Security

- Placeholder Telegram OIDC emails remain unverified. Telegram does not return an email claim, so the plugin will not mark a generated `{sub}@telegram.oidc` address as verified.

## [1.5.0] - 2026-03-10

### Added

- **`loginWidget` option** ([#16](https://github.com/vcode-sh/better-auth-telegram/issues/16)) — `loginWidget?: boolean` (default `true`). Set to `false` to disable Login Widget endpoints (`/telegram/signin`, `/telegram/link`, `/telegram/unlink`) and omit Telegram-specific schema fields (`telegramId`, `telegramUsername`, `telegramPhoneNumber` on user; `telegramId`, `telegramUsername` on account). OIDC-only setups no longer get 5 unused database columns cluttering their schema. Schema fields are still included when `miniApp.enabled` is true, because Mini App flows need them. Zero breaking changes — `undefined` defaults to `true`.
- **`loginWidgetEnabled` in config response** — `GET /telegram/config` now returns `loginWidgetEnabled` boolean alongside existing flags. Client `getTelegramConfig` type updated.

### Fixed

- **Incorrect cross-provider comments** — Comments in `/telegram/signin` and `/telegram/miniapp/signin` said "created via OIDC or Mini App" / "created via OIDC or Login Widget". OIDC never sets `telegramId` on the user table, so those comments were wrong. Fixed to just "Mini App" / "Login Widget".
- **Rate limits always registered** — Widget and Mini App rate limits were always included regardless of whether those flows were enabled. Now conditional — only registered when the corresponding flow is active.

### Changed

- Test count: 235 → ~261. 26 new tests covering `loginWidget` schema derivation, endpoint registration, config response, rate limits, edge cases, and backward compatibility.

## [1.4.0] - 2026-03-01

### Fixed

- **OIDC actually works now** ([#11](https://github.com/vcode-sh/better-auth-telegram/issues/11)) — Telegram published [official OIDC docs](https://core.telegram.org/bots/telegram-login) and it turns out: (1) the Client Secret is NOT the bot token — BotFather provides a separate secret via Bot Settings > Web Login, (2) `origin` and `bot_id` are not standard OIDC parameters and were causing Telegram to fall back to Login Widget redirects, (3) Allowed URLs (including the callback URI) must be registered in BotFather's Web Login settings. Removed `origin` and `bot_id` from `additionalParams`. Auth URL is now clean standard OIDC: `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`, PKCE. Previous versions used the bot token as `client_secret` which Telegram rejected with `invalid_client`.
- **OIDC cross-domain redirect fixed** ([#12](https://github.com/vcode-sh/better-auth-telegram/issues/12)) — v1.3.0 derived `origin` from the backend `redirectURI` and passed it to Telegram's auth endpoint. When frontend and backend lived on different domains (e.g., `app.example.com` + `api.example.com`), Telegram redirected to `api.example.com/#tgAuthResult=...` — a hash fragment the server never sees. Removing `origin` entirely fixes this: Telegram now uses the standard `redirect_uri` with `?code=` query params. The OAuth 2.0 spec wins again.
- **Login Widget / Mini App P2002 crash when user exists via OIDC** ([#13](https://github.com/vcode-sh/better-auth-telegram/issues/13)) — `/telegram/signin` and `/telegram/miniapp/signin` only looked for accounts with `providerId=telegram`. If the same Telegram user had previously authenticated via OIDC (`providerId=telegram-oidc`), the endpoint skipped straight to `adapter.create({ model: "user" })` and Prisma threw `P2002: Unique constraint failed on email`. Now both endpoints check for an existing user by `telegramId` before attempting user creation. If found, they link a `telegram` account to the existing user instead of creating a duplicate. Works regardless of `autoCreateUser` — linking an existing user is not creating a new one.

### Added

- **`oidc.clientSecret` option** — Pass the Client Secret from BotFather's Web Login settings. This is the actual OIDC client secret, not the bot token. Falls back to bot token with a `console.warn` if omitted (for backward compatibility), but OIDC won't work without the proper secret.
- **Proper OIDC setup documentation** — Step-by-step BotFather Web Login walkthrough, including the undocumented "remove URL then reopen to unlock OpenID Connect Login" ritual. Covers Allowed URL (trusted origin), Redirect URL (callback URI), Client ID/Secret retrieval, and local dev ngrok setup. Because Telegram's own docs assume you already know. You didn't. Neither did we.

### Changed

- **Test app restructured** — Login Widget isolated to `/widget` page, Mini App SDK loaded dynamically only on `/miniapp`, home page is now a hub with links. Prevents cross-flow interference during testing.
- Test count: 225 → 235. Nine new tests: cross-provider account linking for Login Widget (5) and Mini App (3) with P2002 reproduction, plus OIDC auth URL regression guard against `additionalParams`/`origin`/`bot_id` (1). All nine fail against v1.3.x code, pass against v1.4.0.

## [1.3.3] - 2026-03-01

### Fixed

- **`bot_id` actually ships this time** ([#11](https://github.com/vcode-sh/better-auth-telegram/issues/11)) — The v1.3.2 source had the `bot_id` fix but the npm dist was built before the change landed. The published package sent `additionalParams: { origin }` instead of `additionalParams: { origin, bot_id: botId }`. This release rebuilds from the correct source. Superseded by v1.4.0 which removes `bot_id` entirely per official Telegram OIDC docs.

### Added

- **OIDC prerequisites documentation** — now updated in v1.4.0 with the correct BotFather Web Login setup.

### Changed

- **Test app restructured** — Login Widget isolated to `/widget` page, Mini App SDK loaded dynamically only on `/miniapp`, home page is now a hub with links. Prevents cross-flow interference during testing (the widget was auto-initializing and hijacking OIDC redirects).

## [1.3.2] - 2026-03-01

### Fixed

- **OIDC authorization URL missing `bot_id` parameter** ([#11](https://github.com/vcode-sh/better-auth-telegram/issues/11)) — Telegram's `oauth.telegram.org/auth` endpoint expects `bot_id`, not the standard OAuth2 `client_id`. Better Auth's pipeline sends `client_id` (per spec), and Telegram *appears* to accept it — the user authorizes, gets a code back, everything looks fine. But the scopes don't stick. The token endpoint returns tokens without `id_token`, our `getUserInfo` checks `token.idToken`, finds nothing, returns null, and Better Auth logs "Unable to get user info". The fix: send `bot_id` alongside `client_id` in `additionalParams`. Telegram gets what it wants, the spec stays satisfied, `id_token` comes back in the token response. Everybody wins. Confirmed by [@flxxxxddd](https://github.com/flxxxxddd) who reproduced the bug on the test playground app — so this wasn't a config issue, it was genuinely broken.

### Added

- **Diagnostic logging in `getUserInfo`** — when `getUserInfo` returns null, it now `console.warn`s with the exact reason: missing `id_token` (with token keys and raw response keys), failed JWT decode (with the error message), or missing `sub` claim (with the claim keys present). No more guessing which of the three null-return paths killed your OIDC flow.

## [1.3.1] - 2026-03-01

### Fixed

- **OIDC `verifyIdToken` now fails gracefully** — previously, if the JWKS fetch failed, the key ID wasn't found, the token had a wrong issuer/audience, was expired, or was signed with a different key, `verifyIdToken` would throw an unhandled error straight into Better Auth's callback handler. Better Auth would catch it and log `Unable to get user info` — technically accurate, spectacularly unhelpful. Now wrapped in a try-catch that returns `false` instead of throwing. Invalid tokens get rejected cleanly. Network failures don't produce cryptic error messages. The OIDC flow degrades gracefully instead of dramatically.

### Changed

- Six `verifyIdToken` tests updated from `rejects.toThrow()` to `expect(result).toBe(false)` — the tests now match the graceful failure behaviour instead of expecting explosions.

## [1.3.0] - 2026-03-01

### Fixed

- **OIDC "Unable to get user info" error** ([#11](https://github.com/vcode-sh/better-auth-telegram/issues/11)) — two bugs squashed in one commit. First: `getUserInfo` was silently returning `null` on malformed JWT tokens instead of catching the decode error. Better Auth's callback handler interprets `null` as "this provider is broken" and logs the terrifying `Unable to get user info` message that made [@flxxxxddd](https://github.com/flxxxxddd) file a comment. Now it catches `decodeJwt` failures gracefully. Second: Telegram OIDC doesn't provide an email claim (because Telegram), but Better Auth's callback flow *requires* one or it rejects with `email_not_found`. Now generates a placeholder email (`{telegramId}@telegram.oidc`) so the flow completes. Users can override via `mapOIDCProfileToUser` if they have a real email. The `sub` claim is also validated — no more phantom users from empty JWTs.
- **OIDC "origin required" error** — Telegram's `oauth.telegram.org/auth` endpoint requires an `origin` parameter matching the redirect URI's origin. We weren't sending it. Now extracted from `redirectURI` and passed via `additionalParams`. The redirect actually redirects now. Revolutionary.

### Added

- **Test playground app** (`test/` directory) — a full Next.js 16 app demonstrating all three auth flows: Login Widget, Mini App, and OIDC. Includes ngrok setup instructions for testing OIDC locally. Because "just trust me, it works" stopped being acceptable three versions ago. SQLite + Prisma for zero-config database setup. No credentials committed — `.env.local.example` tells you what to fill in.

### Changed

- Test count: 219 → 221 tests. Two new edge cases for OIDC `getUserInfo`: malformed JWT handling and missing `sub` claim validation. Coverage remains at 100% because we don't ship regressions, we ship fixes.

## [1.2.0] - 2026-03-01

### Fixed

- **Residual TS2532 errors in OIDC tests** — `plugin.init!(mockCtx)` could return `void` because the `init` hook is conditionally spread. Added non-null assertions and extracted a `providers` variable. Three fewer red squiggles haunting the test suite. TypeScript is now merely disappointed, not furious.

### Added

- **Telegram test server support** (`testMode` option) — set `testMode: true` and your bot talks to Telegram's test environment DCs instead of production. HMAC verification is token-agnostic (same algorithm, different token), so zero crypto changes were needed. Logs a warning when combined with OIDC because `oauth.telegram.org` has no documented test variant — your OIDC flow might just stare into the void. Proceed at your own risk.
- **`BetterAuthPluginRegistry` module augmentation** — declares the `telegram` plugin in Better Auth's plugin registry so `ctx.context.getPlugin("telegram")` and `ctx.context.hasPlugin("telegram")` actually know what they're looking at. Type-only, zero runtime impact. Emitted in both `.d.ts` and `.d.cts` because dual-format builds deserve dual-format suffering.

### Changed

- `GET /telegram/config` now returns `testMode` boolean alongside `botUsername`, `miniAppEnabled`, and `oidcEnabled`. Your client finally knows which universe it's authenticating against.
- Test count: 173 → 219 tests. 100% coverage across statements, branches, functions, and lines. The test suite has achieved its final form.

## [1.1.0] - 2026-03-01

### Breaking Changes

- **Peer dependency bumped to `better-auth@^1.5.0`** — if you're still on 1.4.x, this is your eviction notice. Better Auth 1.5 changed the `BetterAuthPlugin` interface and we had to follow. Upgrade or enjoy the red squiggles.

### Changed

- **Error codes migrated to `defineErrorCodes()`** — `ERROR_CODES` now uses `defineErrorCodes()` from `@better-auth/core/utils/error-codes`. Each error code is a proper `RawError` object (`{ code, message }`) instead of a plain string. This satisfies Better Auth 1.5's `$ERROR_CODES` type requirement — the whole reason [#11](https://github.com/vcode-sh/better-auth-telegram/issues/11) exists.
- **All `APIError` throws migrated to `APIError.from()`** — 14 `throw new APIError("STATUS", { message })` calls replaced with `throw APIError.from("STATUS", ERROR_CODES.X)`. Same behaviour, new API. Better Auth 1.5 approves.
- **Removed `(ctx: any)` on init hook** — the OIDC `init` callback now lets TypeScript infer `AuthContext` from the plugin type instead of pretending everything is `any`.
- **`@better-auth/core` added to tsup externals** — the `defineErrorCodes` import won't get bundled into your dist. It's resolved at runtime from the better-auth ecosystem, as nature intended.

### Fixed

- **Type mismatch with `better-auth@1.5.0`** ([#11](https://github.com/vcode-sh/better-auth-telegram/issues/11)) — the plugin's `$ERROR_CODES` now satisfies `Record<string, RawError>` instead of the old `Record<string, string>`. Thanks to [@flxxxxddd](https://github.com/flxxxxddd) and [@RainyPixel](https://github.com/RainyPixel) for reporting and confirming the issue.
- **OIDC test mocks updated** — `AuthContext` in Better Auth 1.5 now requires `getPlugin` and `hasPlugin` properties. Test mocks updated accordingly.

### Upgraded

- `better-auth` peer dependency: `^1.4.18` → `^1.5.0`

## [1.0.0] - 2026-03-01

### Added

- **Telegram OIDC authentication** — Standard OAuth 2.0 Authorization Code flow with PKCE via `oauth.telegram.org`. Proper grown-up auth instead of widget callbacks. Telegram finally joined the OAuth federation with Bot API 9.5.
- **Phone number access** — the `phone` scope gives you what the Login Widget never could. Set `requestPhone: true` and stop guessing.
- **RS256 JWT verification** — ID tokens verified against Telegram's JWKS endpoint using `jose` library. Keys fetched and matched by `kid` — no hardcoded secrets, no trust-me-bro validation.
- **Zero custom endpoints** — injects a `telegram-oidc` provider into Better Auth's social login system via the `init` hook. Uses standard `POST /sign-in/social` and `GET /callback/telegram-oidc` routes. Better Auth does the heavy lifting.
- **New `telegramPhoneNumber` field** — added to the user schema, populated via OIDC phone scope.
- **Client `signInWithTelegramOIDC()` method** — triggers the OIDC flow from the browser. Pass `callbackURL` and let Better Auth's social login pipeline handle the rest.
- **New module `src/oidc.ts`** — OIDC provider factory. Creates an `OAuthProvider` with authorization, token exchange, user profile mapping, and ID token verification.
- **New types** — `TelegramOIDCOptions`, `TelegramOIDCClaims` for OIDC configuration and JWT claims.
- **New constants** — `TELEGRAM_OIDC_PROVIDER_ID`, `TELEGRAM_OIDC_ISSUER`, `TELEGRAM_OIDC_AUTH_ENDPOINT`, `TELEGRAM_OIDC_TOKEN_ENDPOINT`, `TELEGRAM_OIDC_JWKS_URI`.
- **56 new tests** — comprehensive OIDC test suite covering provider creation, JWT verification, JWKS fetching, error cases, and init hook behaviour. 117 → 173 tests total.
- **`CLAUDE.md`** — project instructions for Claude Code with architecture overview, commands, and review guidelines.
- **Code of Conduct** — Contributor Covenant 2.1.
- **Security Policy** — `SECURITY.md` with vulnerability reporting guidelines.
- **Dependabot configuration** — automated dependency updates for npm and GitHub Actions.
- **AI code review workflow** — Claude-powered PR reviews via `claude.yml`.
- **Dependabot auto-merge workflow** — auto-merges minor/patch dependency bumps.
- **Issue templates** — bug report and feature request templates with structured fields.
- **`CODEOWNERS`** — code ownership for automated review assignment.

### Changed

- `GET /telegram/config` now returns `oidcEnabled` flag.
- Documentation overhauled — streamlined docs, removed redundant content, added OIDC configuration and usage examples.

### Configuration

OIDC can be enabled by adding the `oidc` option:

```typescript
// Server
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "your_bot_username",
  oidc: {
    enabled: true,
    requestPhone: true,
    requestBotAccess: false,
    scopes: ["openid", "profile"],
    mapOIDCProfileToUser: (claims) => ({
      name: `${claims.first_name} ${claims.last_name}`,
    }),
  },
});

// Client
await authClient.signInWithTelegramOIDC({
  callbackURL: "/dashboard",
});
```

### Breaking Changes

None — OIDC is opt-in (`oidc.enabled: false` by default). All existing Login Widget and Mini App flows are untouched. Version bumped to 1.0.0 to mark feature completeness, not breaking changes.

## [0.4.0] - 2026-02-21

### Breaking Changes

- **Verification functions are now async** — `verifyTelegramAuth()` and `verifyMiniAppInitData()` return `Promise<boolean>` instead of `boolean`. If you were calling these directly (you rebel), slap an `await` in front and carry on.
- **Errors now throw `APIError` instead of returning JSON** — all endpoint error responses now throw `APIError` from `better-auth/api` instead of returning `ctx.json({ error }, { status })`. This is the canonical Better Auth pattern. If you were catching errors by checking `response.data.error`, switch to the standard `{ error }` shape from Better Auth's error pipeline. Your error handling just got an upgrade it didn't ask for.
- **Peer dependency bumped** — requires `better-auth@^1.4.18`. The `^1.0.0` era was fun while it lasted.
- **Package is now ESM-first** — added `"type": "module"` to package.json. CJS still works via `.cjs` exports because we're not monsters.

### Changed

- **Ditched `node:crypto` for Web Crypto API** — verification now uses `globalThis.crypto.subtle` instead of Node's `createHmac`/`createHash`. Works in Cloudflare Workers, Vite, Convex, and other runtimes that were previously throwing tantrums about `node:crypto`. Shoutout to [@ic4l4s9c](https://github.com/ic4l4s9c) and [@Mukhammadali](https://github.com/Mukhammadali) for making enough noise about this ([#3](https://github.com/vcode-sh/better-auth-telegram/pull/3)).
- **Migrated all errors to `APIError` throws** — 14 error returns replaced with proper `throw new APIError("STATUS", { message })`. Status codes mapped to: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`. Better Auth's error pipeline now handles the drama instead of raw JSON.
- **Extracted error codes to `src/constants.ts`** — no more magic strings scattered across the codebase like confetti at a failed deployment. All error messages, success messages, and defaults now live in one place.
- **Types converted from `type` to `interface`** — because `ultracite/core` said so, and who are we to argue with a linter.
- **Killed all `as any` casts in server plugin** — introduced `TelegramAccountRecord` interface. Four `as any` casts replaced with proper types. TypeScript is no longer crying in the corner.
- **Stricter TypeScript config** — added `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`. Your IDE will thank you. Your deadline won't.
- **Package exports restructured** — proper nested `import`/`require` paths with separate type definitions for each format. The way npm intended, allegedly.

### Added

- **`$ERROR_CODES` export on plugin** — the plugin object now exposes `$ERROR_CODES` so consumers can match error types client-side instead of comparing against magic strings like animals. `if (error.message === plugin.$ERROR_CODES.NOT_AUTHENTICATED)` — civilised.
- **Per-endpoint rate limiting** — all plugin endpoints now have rate limit rules. Signin/miniapp: 10 req/60s. Link/unlink: 5 req/60s. Validate: 20 req/60s. Brute-forcing Telegram auth was never a good strategy, now it's also a throttled one.
- **`input: false` on user schema fields** — `telegramId` and `telegramUsername` on the user table now reject direct input during signup. No more creative users setting their own Telegram ID to Elon's.
- **`TelegramAccountRecord` type** — new exported interface for Better Auth adapter account records. Replaces guesswork with proper types.
- **Client `fetchOptions` support** — all API-calling client methods (`signInWithTelegram`, `linkTelegram`, `unlinkTelegram`, `getTelegramConfig`, `signInWithMiniApp`, `validateMiniApp`, `autoSignInFromMiniApp`) now accept an optional `fetchOptions` parameter. Custom headers, cache control, credentials — pass through whatever your heart desires. Widget init methods excluded because they're browser utilities, not your fetch playground.
- **7 new tests** — fetchOptions passthrough coverage for all client API methods plus backward compatibility check. 110 → 117 tests total. The test suite grows stronger.
- **CI/CD pipeline** — GitHub Actions with Node 22.x/24.x matrix, Bun runtime tests, build artifact verification with size reporting to step summary, and lint checks. Because shipping untested code is a personality trait, not a strategy.
- **PR validation workflow** — separate `pr-validation.yml` runs TODO/FIXME detection, `npm audit` security scan, and bundle size reporting. PRs now get judged before they even reach main.
- **Release workflow** — `release.yml` triggers on `v*` tags, runs the full test/build pipeline, then publishes to npm with `--provenance` and auto-creates a GitHub Release. Push a tag, go make coffee.
- **Actions upgraded to v6** — `actions/checkout` and `actions/setup-node` bumped from v4 to v6. `codecov/codecov-action` from v4 to v5 with proper token support. Living in the past was never the vibe.
- **Vitest setup file** — `vitest.setup.ts` configures happy-dom's `handleDisabledFileLoadingAsSuccess` to suppress `DOMException` spam when tests append `<script>` elements. Clean test output was always the plan. Eventually.
- **`.nvmrc`** — pinned to Node 22. Stop guessing.
- **`lint-staged` config** — runs `ultracite fix` before every commit. Your messy code gets formatted whether it likes it or not.
- **`sideEffects: false`** in package.json — tree-shaking support for the three people who care about bundle size.
- **`prepublishOnly` script** — type-check, test, and build all run before publish. No more "oops, pushed broken types to npm" incidents.

### Upgraded

- `@biomejs/biome` 2.2.4 → 2.4.4
- `ultracite` 5.4.5 → 7.2.3 (extends `ultracite/core` now)
- `vitest` 3.2.4 → 4.0.18
- `happy-dom` 19.0.2 → 20.6.3
- `tsup` 8.5.0 → 8.5.1
- Added `@vitest/coverage-v8` 4.0.18
- Added `lint-staged` 16.2.7
- `zod` added to tsup externals

### Fixed

- Fixed `createSession` API call — was passing full endpoint context instead of just userId. Better Auth's internal adapter was too polite to crash, but TypeScript wasn't.
- Removed rogue `package-manager=pnpm` from `.npmrc` that was causing npm to passive-aggressively warn on every install.

## [0.3.2] - 2025-10-25

### Fixed

- **Critical:** Session middleware not declared in link/unlink endpoints ([#2](https://github.com/vcode-sh/better-auth-telegram/issues/2))
  - Added `sessionMiddleware` to `linkTelegram` and `unlinkTelegram` endpoints
  - Better Auth requires explicit middleware declaration to populate `ctx.context.session`
  - Without it, session was always null even when cookies were sent correctly
  - Users trying to link Telegram accounts were getting "Not authenticated" errors
  - Thanks to [@iatomic1](https://github.com/iatomic1) for the thorough debugging and local testing

## [0.3.1] - 2025-10-14

### Fixed

- **Critical:** Session cookies not being set after successful authentication ([#1](https://github.com/vcode-sh/better-auth-telegram/pull/1))
  - Added `setSessionCookie()` calls to both `signInWithTelegram` and `signInWithMiniApp` endpoints
  - Users can now actually stay logged in after authentication (turns out that's important)
  - Implementation follows official better-auth plugin pattern
  - Thanks to [@tooonuch](https://github.com/tooonuch) for catching this and submitting the fix

### Changed

- Improved CI/CD pipeline with PR validation workflow
- Added branch protection rules and automated checks
- Enhanced code quality gates

## [0.3.0] - 2025-10-01

### Added

- **Ultracite/Biome integration** for code quality and formatting
  - Biome 2.2.4 (Rust-based linter and formatter)
  - Ultracite 5.4.5 (AI-ready preset configuration)
  - Lint-staged for pre-commit hooks
  - VSCode integration for consistent formatting

### Changed

- **Code quality improvements**
  - Converted all `interface` declarations to `type` for consistency
  - Updated imports from `crypto` to `node:crypto` (Node.js modern imports)
  - Improved code formatting and consistency across all files
  - Better import ordering and organization
- **Test improvements**
  - Enhanced test reliability for widget loading scenarios
  - Improved test coverage from 99.63% to **100%**
  - Added 4 new tests (110 total)
  - Fixed edge cases in hash generation tests using proper destructuring
- **Documentation updates**
  - Updated README.md with Vibe Code tone and personal touch
  - Added "A word from the author" section
  - Enhanced documentation with better humor and accessibility

### Fixed

- Improved test stability in happy-dom environment
- Fixed script loading test race conditions
- Better error handling coverage in client tests

### Development

- Added Biome configuration (`biome.jsonc`)
- Added VSCode settings for consistent development experience
- Configured lint-staged for automatic code formatting on commit
- Disabled opinionated rules that conflict with Telegram API naming conventions

### Breaking Changes

None - v0.3.0 is fully backward compatible with v0.2.0

## [0.2.0] - 2025-10-01

### Added

- **Telegram Mini Apps support**
  - New `miniApp` configuration option in plugin settings
  - `signInWithMiniApp()` client method for Mini App authentication
  - `validateMiniApp()` client method for initData validation
  - `autoSignInFromMiniApp()` client method for automatic sign-in
  - `POST /telegram/miniapp/signin` server endpoint
  - `POST /telegram/miniapp/validate` server endpoint
  - Support for Telegram.WebApp.initData parsing and validation
- **New types for Mini Apps**
  - `TelegramMiniAppUser` - User data from Mini Apps
  - `TelegramMiniAppChat` - Chat information from Mini Apps
  - `TelegramMiniAppData` - Complete initData structure
  - Mini App configuration options in `TelegramPluginOptions`
- **Enhanced verification**
  - `verifyMiniAppInitData()` - HMAC-SHA-256 verification for Mini Apps
  - `parseMiniAppInitData()` - Parse URL-encoded initData string
  - `validateMiniAppData()` - Validate Mini App data structure
  - Support for WebAppData secret key derivation (different from Login Widget)
- **Additional user fields from Mini Apps**
  - `language_code` - User's language preference
  - `is_premium` - Telegram Premium status
  - `is_bot` - Bot account indicator
  - `allows_write_to_pm` - PM permission status
- **Mini App context data**
  - `query_id` - Unique Mini App session ID
  - `start_param` - Start parameter from deep links
  - `chat_type` - Type of chat (sender/private/group/etc.)
  - `chat_instance` - Unique chat identifier
  - `chat` - Full chat object with details
  - `receiver` - Chat partner information
  - `can_send_after` - Message sending delay

### Changed

- `GET /telegram/config` now returns `miniAppEnabled` flag
- Improved test coverage from 95.42% to 97%
- Added 35 new tests (71 → 106 tests total)

### Security

- Different HMAC secret key derivation for Mini Apps vs Login Widget
- Mini Apps use `HMAC-SHA256("WebAppData", bot_token)` for secret key
- Login Widget uses `SHA256(bot_token)` for secret key
- Both methods maintain same security level with replay attack prevention

### Configuration

Mini Apps can be enabled by adding the `miniApp` option:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "your_bot",
  miniApp: {
    enabled: true,
    validateInitData: true, // default
    allowAutoSignin: true,  // default
    mapMiniAppDataToUser: (user) => ({
      name: user.username || user.first_name,
      // custom mapping...
    }),
  },
})
```

### Breaking Changes

None - v0.2.0 is fully backward compatible with v0.1.0

## [0.1.0] - 2025-09-30

### Added

- Initial release of better-auth-telegram plugin
- Telegram Login Widget integration for Better Auth
- HMAC-SHA-256 verification for authentication data
- Replay attack prevention with `auth_date` validation
- Server plugin with authentication endpoints:
  - `POST /telegram/signin` - Sign in or create user
  - `POST /telegram/link` - Link Telegram to existing account
  - `POST /telegram/unlink` - Remove Telegram connection
  - `GET /telegram/config` - Get bot configuration
- Client plugin with widget initialization and methods:
  - `signInWithTelegram()` - Sign in with Telegram
  - `linkTelegram()` - Link account
  - `unlinkTelegram()` - Unlink account
  - `getTelegramConfig()` - Get bot info
  - `initTelegramWidget()` - Initialize with callback
  - `initTelegramWidgetRedirect()` - Initialize with redirect
- Database schema extensions:
  - `telegramId` field for User and Account tables
  - `telegramUsername` field for User and Account tables
- Full TypeScript support with type definitions
- Customizable widget options (size, photo, corner radius, language)
- Custom user data mapping function
- Configurable security settings (max auth age, auto-create user, allow linking)
- Framework-agnostic implementation
- Works with all Better Auth database adapters (Prisma, Kysely, Drizzle)

### Documentation

- Comprehensive README with quick start guide
- Complete installation guide with step-by-step instructions
- Usage guide with examples for React, Next.js, and vanilla JavaScript
- Full API reference documentation
- Configuration guide covering all options
- Security best practices guide
- Troubleshooting guide for common issues
- Documentation index at `docs/README.md`

### Examples

- Next.js App Router example configuration
- Next.js Pages Router example configuration

### Security

- HMAC-SHA-256 signature verification
- Timestamp validation to prevent replay attacks (default 24 hour window)
- Bot token never exposed to client
- Secure session management via Better Auth
- HTTPS requirement (enforced by Telegram)

### Configuration Options

#### Server Plugin

- `botToken` (required) - Bot token from @BotFather
- `botUsername` (required) - Bot username without @
- `allowUserToLink` (optional) - Allow linking Telegram to existing accounts (default: true)
- `autoCreateUser` (optional) - Auto-create users on first sign-in (default: true)
- `maxAuthAge` (optional) - Maximum age of authentication data in seconds (default: 86400)
- `mapTelegramDataToUser` (optional) - Custom function to map Telegram data to user object

#### Client Widget

- `size` - Button size: "large", "medium", or "small"
- `showUserPhoto` - Show user's profile photo
- `cornerRadius` - Border radius in pixels (0-20)
- `requestAccess` - Request write access permission
- `lang` - Language code (e.g., "en", "pl", "ru")

### Package Metadata

- Author: Vibe Code <hello@vcode.sh>
- Repository: https://github.com/vcode-sh/better-auth-telegram
- License: MIT
- Keywords: better-auth, telegram, authentication, plugin, typescript

[1.5.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v1.5.0
[1.4.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v1.4.0
[1.3.3]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v1.3.3
[1.3.2]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v1.3.2
[1.3.1]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v1.3.1
[1.3.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v1.3.0
[1.2.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v1.2.0
[1.1.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v1.1.0
[1.0.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v1.0.0
[0.4.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v0.4.0
[0.3.2]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v0.3.2
[0.3.1]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v0.3.1
[0.3.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v0.3.0
[0.2.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v0.2.0
[0.1.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v0.1.0
