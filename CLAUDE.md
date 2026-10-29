# better-auth-telegram

Telegram authentication plugin for [Better Auth](https://www.better-auth.com/). Login Widget + Mini App + OIDC auth flows, published as `better-auth-telegram` on npm.

## Architecture

Two entry points, two export paths:

- **`src/index.ts`** -> `better-auth-telegram` -- Server plugin (`BetterAuthPlugin`)
- **`src/client.ts`** -> `better-auth-telegram/client` -- Browser client plugin (widget management, Mini App auto-signin)

Supporting modules:

- **`src/verify.ts`** -- HMAC-SHA256 verification via Web Crypto API. Two paths: Login Widget (`SHA256(botToken)`) and Mini App (`HMAC-SHA256("WebAppData", botToken)`)
- **`src/oidc.ts`** -- Telegram OIDC provider factory. Creates a Better Auth 1.7 `OAuthProvider` (`accountSubject` = `sub`, declarative `idToken`, `requiresIdTokenNonce`) for the Authorization Code flow with PKCE and nonce via `oauth.telegram.org`. Basic client auth; ID tokens verified against the cached JWKS before claims are used.
- **`src/telegram-identity.ts`** -- Request-scoped verified OIDC claims plus the `databaseHooks` installed via `init`: copy `id`/`preferred_username`/`phone_number` onto the user (and the OIDC account) for the user owning that `sub`; re-check `user.telegramId` whenever a Telegram account is deleted (by any route); reserve the placeholder email domains for the Telegram flows.
- **`src/telegram-account.ts`** -- Shared Login Widget / Mini App account logic (find, link, create, unlink) through `ctx.context.internalAdapter`, so `databaseHooks` and `user.validateUserInfo` apply.
- **`src/testing/harness.ts`** -- Test-only: real `betterAuth()` on the memory adapter or SQLite (Better Auth migrations), and a fake oauth.telegram.org modeled on live behavior (key rotation, JWKS outage).
- **`src/testing/adapters.ts`** -- Test-only: Better Auth on PostgreSQL / MySQL (Kysely), Drizzle, Prisma and MongoDB for the adapter lane (`*.adapter.test.ts`), each skipped unless its `BAT_TEST_*_URL` is set.
- **`src/types.ts`** -- All TypeScript interfaces (`TelegramPluginOptions`, `TelegramAuthData`, Mini App types, `TelegramOIDCOptions`, `TelegramOIDCClaims`)
- **`src/constants.ts`** -- Error codes, success messages, `PLUGIN_ID`, `DEFAULT_MAX_AUTH_AGE`, OIDC endpoints/issuer constants

### Server Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/telegram/signin` | None | Authenticate with Login Widget data |
| POST | `/telegram/link` | Session | Link Telegram to current user |
| POST | `/telegram/unlink` | Session | Unlink Telegram from current user |
| GET | `/telegram/config` | None | Returns bot username for widget init |
| POST | `/telegram/miniapp/signin` | None | Sign in from Mini App (optional) |
| POST | `/telegram/miniapp/validate` | None | Validate Mini App initData (optional) |

OIDC (when `oidc.enabled`) uses Better Auth's built-in social login routes (`POST /sign-in/social` with `provider: "telegram-oidc"`, `GET /callback/telegram-oidc`). The plugin injects a `telegram-oidc` social provider via the `init` hook.

Schema conditionally extends `user` table with `telegramId`, `telegramUsername`, and `telegramPhoneNumber` fields, and `account` table with `telegramId` and `telegramUsername` fields — only when Login Widget or Mini App flows are enabled (default). OIDC-only setups (`loginWidget: false`) skip these fields.

## Code Style

- **Biome** via ultracite (`biome.jsonc` extends `ultracite/biome/core` and `ultracite/biome/vitest`; `examples/` and `test/` are excluded)
- **lint-staged** runs `ultracite fix` on pre-commit
- Relaxed rules: `noNonNullAssertion`, `noExplicitAny`, `useNamingConvention`, `noMagicNumbers` all off
- ES modules, `verbatimModuleSyntax`, strict null checks, `noUncheckedIndexedAccess`

## Testing

- **Vitest** with `happy-dom` environment; `*.integration.test.ts` run in `node` against a real Better Auth instance (see `src/testing/harness.ts`). Prefer those over mocking Better Auth: mock-only tests passed while OIDC was broken on 1.7.
- Tests co-located in `src/` (`*.test.ts`)
- `npm run test:types` compiles `test-d/consumer.ts` against the built `dist/` (run `npm run build` first)
- `*.adapter.test.ts` (the adapter lane) is excluded from `npm test`; CI runs it in the `adapters` job with service containers. Concurrency and driver typing (PostgreSQL integer ids) only show up there: SQLite serializes every query.
- Better Auth disables its origin checks under `NODE_ENV=test`; tests of CSRF behavior set `advanced.disableOriginCheck: false`.
- Coverage: v8 provider, thresholds -- 90% lines/statements/branches, 80% functions
- `vitest.setup.ts` suppresses happy-dom DOMException warnings for script loading

## Commands

```bash
npm run build          # tsdown (ESM + CJS + .d.ts, publint + attw)
npm run dev            # tsdown --watch
npm run test:types     # type-check a consumer of dist/
npm run test:package   # build first; install and verify the release tarball
npm run type-check     # tsc --noEmit
npm run test           # vitest run
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest run --coverage
npm run test:adapters  # real databases; needs BAT_TEST_POSTGRES_URL / _MYSQL_URL / _MONGODB_URL (see vitest.adapters.config.ts)
npm run lint           # ultracite check
npm run lint:fix       # ultracite fix
```

Single test file: `npx vitest run src/verify.test.ts`

## Dependencies

**Runtime (peer):** `better-auth`, `@better-auth/core` (`>=1.7.12 <1.8.0`; 1.7.7 fixed GHSA-965c-763c-88jm, 1.7.12 made every OAuth callback route — including oauth-proxy — enforce the ID token nonce)

**Runtime (dependency):** `jose`

**Build:** tsdown keeps peers and dependencies external; better-call types are inlined into the `.d.ts` on purpose (not our dependency)

**Dev:** Biome 2.6 via ultracite 8, tsdown, TypeScript 7, Vitest 5, happy-dom

**Node:** >= 24.0.0 (`engines.node`, tested on 24.0.0, current 24 and 26 in CI); 24 for development (`.nvmrc`)

## Review Guidelines

- Verification logic in `verify.ts` is security-critical -- changes to HMAC computation or timestamp checks need extra scrutiny
- `botToken` must never leak to client-side code. Server plugin only.
- All endpoints use `createAuthEndpoint()` from `better-auth/api`. Follow that pattern.
- Write users/accounts through `ctx.context.internalAdapter`, never raw `ctx.context.adapter.create` (that skips `databaseHooks` and `validateUserInfo`). Reads via `adapter.findOne` are fine.
- Telegram facts verified live (2026-10-29): OIDC `sub` is per bot (use the `id` claim, a string, for the Telegram user id); switching a bot to OIDC permanently disables its legacy Login Widget; BotFather rejects localhost redirect URIs; ID tokens live 30 s; token errors come back as HTTP 200; declining the OIDC login in the Telegram app sends no callback at all (oauth.telegram.org shows its account picker again).
- Session-protected endpoints use `sessionMiddleware`. Don't forget it for authenticated routes.
- Type guards (`validateTelegramAuthData`, `validateMiniAppData`) run before processing. Don't skip validation.
- Mini App endpoints are conditionally registered (`miniApp.enabled`). Test both enabled and disabled paths.
- OIDC provider is conditionally injected via `init` hook (`oidc.enabled`). JWT verification in `oidc.ts` uses `jose` library -- changes to JWKS fetching or token validation need scrutiny.
- HTTP status codes: 400 (validation), 401 (auth), 403 (disabled), 404 (not found), 409 (conflict)
- Coverage thresholds are enforced in CI. New code needs tests.
