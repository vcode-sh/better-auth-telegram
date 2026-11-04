# better-auth-telegram

Telegram authentication plugin for [Better Auth](https://www.better-auth.com/). Login Widget + Mini App + OIDC auth flows, published as `better-auth-telegram` on npm.

## Architecture

Two entry points, two export paths:

- **`src/index.ts`** -> `better-auth-telegram` -- Server plugin (`BetterAuthPlugin`)
- **`src/client.ts`** -> `better-auth-telegram/client` -- Browser client plugin (widget management, Mini App auto-signin)

Supporting modules:

- **`src/client-widget.ts` and `src/client-types.ts`** -- Browser widget lifecycle and client response/widget types. `client.ts` keeps the API actions, Mini App helpers, session notifications and public exports.
- **`src/verify.ts`** -- HMAC-SHA256 verification via Web Crypto API. Login Widget uses `SHA256(botToken)`; Mini App uses `HMAC-SHA256("WebAppData", botToken)`.
- **`src/oidc.ts` and `src/oidc-token.ts`** -- Better Auth 1.7 provider factory (`accountSubject` = `sub`, PKCE, nonce, Basic client authentication) and cached JWKS/token verification, including profile-ID normalization before claims are used.
- **`src/oidc-linking.ts` and `src/oidc-linking-policy.ts`** -- Match a verified OIDC sign-in to an existing Telegram user before Better Auth's account lookup. Require linked identity proof, preserve existing `sub` ownership, and enforce implicit-linking policy and validation hooks.
- **`src/telegram-account.ts`** -- Find-or-create orchestration for Login Widget and Mini App users. `telegram-account-state.ts` owns shared types, lookups, validation and per-instance operation locks; `telegram-account-user.ts` owns provisioning and profile refresh; `telegram-account-link.ts` owns explicit link/unlink. Writes use Better Auth's internal adapter.
- **`src/telegram-session.ts`** -- Creates sessions and renews cookies for Login Widget and Mini App flows.
- **`src/telegram-identity.ts`** -- Installs database hooks. `telegram-identity-state.ts` holds verified request claims; `telegram-identity-sync.ts` copies and reconciles linked identities; `telegram-identity-session.ts` refreshes OIDC session cookies; `telegram-profile.ts` applies mapped profile updates; `telegram-placeholder.ts` reserves placeholder emails and chooses collision-safe OIDC placeholders.
- **`src/testing/harness.ts`** -- Stable test-fixture imports. Implementations live in `testing/auth.ts` (memory/SQLite Better Auth), `http-client.ts` (cookie-aware requests), `signed-data.ts` (Widget/Mini App fixtures), `oidc-server.ts` (fake Telegram), `oidc-flow.ts` (sign-in helpers) and `constants.ts` (independent fixture constants).
- **`src/testing/adapters.ts`** -- Real PostgreSQL/MySQL (Kysely), Drizzle, Prisma and MongoDB fixtures for `*.adapter.test.ts`; each lane requires its `BAT_TEST_*_URL`.
- **`src/types.ts` and `src/constants.ts`** -- Public server types, defaults, provider IDs and OIDC endpoints. Client types live in `client-types.ts`; widget options live in `client-widget.ts`.

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

Apply [Testing standards](docs/testing.md) to every added, edited or deleted test. Name the contract and the plausible defect; use independent expected results and remove cases with no unique protection.

- **Vitest** with `happy-dom` environment; `*.integration.test.ts` run in `node` against a real Better Auth instance (see `src/testing/harness.ts`). Prefer those over mocking Better Auth: mock-only tests passed while OIDC was broken on 1.7.
- Tests co-located in `src/` (`*.test.ts`). OIDC integration suites separate sign-in, protocol, identity, profile, claims and linking; Widget, Mini App and mapper suites cover their corresponding flows.
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
- Telegram facts verified live (2026-10-29): OIDC `sub` is per bot (use the `id` claim for the Telegram user id; the plugin normalizes verified numeric or string IDs to strings before exposing claims); switching a bot to OIDC permanently disables its legacy Login Widget; BotFather rejects localhost redirect URIs; ID tokens live 30 s; token errors come back as HTTP 200; declining the OIDC login in the Telegram app sends no callback at all (oauth.telegram.org shows its account picker again).
- Session-protected endpoints use `sessionMiddleware`. Don't forget it for authenticated routes.
- Type guards (`validateTelegramAuthData`, `validateMiniAppData`) run before processing. Don't skip validation.
- Mini App endpoints are conditionally registered (`miniApp.enabled`). Test both enabled and disabled paths.
- OIDC provider is conditionally injected via `init` hook (`oidc.enabled`). JWT verification in `oidc-token.ts` uses `jose` library -- changes to JWKS fetching or token validation need scrutiny.
- HTTP status codes: 400 (validation), 401 (auth), 403 (disabled), 404 (not found), 409 (conflict)
- Coverage thresholds are enforced in CI, but coverage does not prove assertions are useful. Add a test only for meaningful behavior not already protected.
