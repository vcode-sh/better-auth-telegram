# better-auth-telegram

Telegram authentication plugin for [Better Auth](https://www.better-auth.com/). Login Widget + Mini App auth flows, published as `better-auth-telegram` on npm.

## Architecture

Two entry points, two export paths:

- **`src/index.ts`** -> `better-auth-telegram` -- Server plugin (`BetterAuthPlugin`)
- **`src/client.ts`** -> `better-auth-telegram/client` -- Browser client plugin (widget management, Mini App auto-signin)

Supporting modules:

- **`src/verify.ts`** -- HMAC-SHA256 verification via Web Crypto API. Two paths: Login Widget (`SHA256(botToken)`) and Mini App (`HMAC-SHA256("WebAppData", botToken)`)
- **`src/types.ts`** -- All TypeScript interfaces (`TelegramPluginOptions`, `TelegramAuthData`, Mini App types)
- **`src/constants.ts`** -- Error codes, success messages, `PLUGIN_ID`, `DEFAULT_MAX_AUTH_AGE`

### Server Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/telegram/signin` | None | Authenticate with Login Widget data |
| POST | `/telegram/link` | Session | Link Telegram to current user |
| POST | `/telegram/unlink` | Session | Unlink Telegram from current user |
| GET | `/telegram/config` | None | Returns bot username for widget init |
| POST | `/telegram/miniapp/signin` | None | Sign in from Mini App (optional) |
| POST | `/telegram/miniapp/validate` | None | Validate Mini App initData (optional) |

Schema extends `user` and `account` tables with `telegramId` and `telegramUsername` fields.

## Code Style

- **Biome** via ultracite (`biome.jsonc` extends `ultracite/core`)
- **lint-staged** runs `ultracite fix` on pre-commit
- Relaxed rules: `noNonNullAssertion`, `noExplicitAny`, `useNamingConvention`, `noMagicNumbers` all off
- ES modules, `verbatimModuleSyntax`, strict null checks, `noUncheckedIndexedAccess`

## Testing

- **Vitest** with `happy-dom` environment
- Tests co-located in `src/` (`*.test.ts`)
- Coverage: v8 provider, thresholds -- 90% lines/statements/branches, 80% functions
- `vitest.setup.ts` suppresses happy-dom DOMException warnings for script loading

## Commands

```bash
npm run build          # tsup (ESM + CJS + .d.ts)
npm run dev            # tsup --watch
npm run type-check     # tsc --noEmit
npm run test           # vitest run
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest run --coverage
npm run lint           # ultracite check
npm run lint:fix       # ultracite fix
```

Single test file: `npx vitest run src/verify.test.ts`

## Dependencies

**Runtime (peer):** `better-auth` (^1.4.18)

**Build external:** `better-auth`, `zod` (tsup external)

**Dev:** Biome, ultracite, tsup, TypeScript 5.9, Vitest 4, happy-dom

**Node:** >= 22.0.0

## Review Guidelines

- Verification logic in `verify.ts` is security-critical -- changes to HMAC computation or timestamp checks need extra scrutiny
- `botToken` must never leak to client-side code. Server plugin only.
- All endpoints use `createAuthEndpoint()` from `better-auth/api`. Follow that pattern.
- Session-protected endpoints use `sessionMiddleware`. Don't forget it for authenticated routes.
- Type guards (`validateTelegramAuthData`, `validateMiniAppData`) run before processing. Don't skip validation.
- Mini App endpoints are conditionally registered (`miniApp.enabled`). Test both enabled and disabled paths.
- HTTP status codes: 400 (validation), 401 (auth), 403 (disabled), 404 (not found), 409 (conflict)
- Coverage thresholds are enforced in CI. New code needs tests.
