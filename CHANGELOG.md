# Changelog

All notable changes to the better-auth-telegram plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
