# Contributing

You want to help build a Telegram auth plugin. Telegram, the platform where bots talk to bots about talking to bots. Sounds about right. Come on in.

## Development Setup

```bash
git clone https://github.com/vcode-sh/better-auth-telegram.git
cd better-auth-telegram
npm install
```

### Prerequisites

- Node.js >= 24 (see `.nvmrc` -- yes, I pinned it, I'm not an animal)
- npm >= 10

## Commands

These are the incantations. Learn them. Love them. Run them before pushing.

```bash
npm run dev          # Watch mode build (tsdown) -- for the impatient
npm run build        # Production build (tsdown: ESM + CJS + DTS, checked by publint + attw) -- the real thing
npm run type-check   # TypeScript strict check -- the compiler judges you so I don't have to
npm run test:types   # Type-check a consumer of the built dist/ (run build first)
npm test             # Run all tests -- you'd be surprised how many people skip this
npm run test:watch   # Watch mode -- for when you're in the zone
npm run test:ui      # Vitest UI -- pretty graphs that prove you did something
npm run test:coverage # Coverage report -- the number must go up
npm run test:adapters # Real PostgreSQL / MySQL / MongoDB (Docker); databases without a BAT_TEST_*_URL are skipped, see vitest.adapters.config.ts
npm run lint         # Biome lint check -- it has opinions and they are correct
npm run lint:fix     # Auto-fix -- let the machine do the boring part
```

## Project Structure

```
src/
  index.ts                Server plugin entry (endpoints, schema, init hook)
  client.ts               Client plugin (widget init, API methods, Mini App helpers)
  plugin-config.ts        Option parsing, defaults, startup warnings
  schema.ts               Conditional user/account schema fields
  widget-endpoints.ts     /telegram/signin, /telegram/link, /telegram/unlink
  miniapp-endpoints.ts    /telegram/miniapp/signin, /telegram/miniapp/validate
  config-endpoint.ts      /telegram/config
  telegram-account.ts     Find/link/create/unlink through Better Auth's internal adapter
  oidc.ts                 telegram-oidc provider (PKCE, nonce, Basic auth, ID token verification)
  telegram-identity.ts    databaseHooks: placeholder email guard, OIDC claims onto user/account,
                          re-checking user.telegramId when a Telegram account is deleted
  verify.ts               HMAC-SHA-256 verification via Web Crypto API
  types.ts                TypeScript interfaces
  constants.ts            Error codes, defaults, PLUGIN_ID, OIDC endpoints
  testing/harness.ts      Real Better Auth (memory or SQLite) plus a fake oauth.telegram.org
  *.test.ts               Co-located unit tests
  *.integration.test.ts   Tests against a real Better Auth instance
test-d/                   Type tests for consumers of dist/
```

## The Rules

Not guidelines. Not suggestions. Rules.

1. **Tests live next to their code** as `*.test.ts` -- no hunting through a distant `__tests__` folder like it's 2017
2. **Run `npm run lint:fix`** before committing -- Biome catches things your eyes won't
3. **All tests must pass** with `npm test` -- a failing test suite is not a "known issue," it's a blocker
4. **Type safety everywhere** -- no `any` at public API boundaries, this isn't JavaScript
5. **Security first, features second** -- validate inputs, verify signatures, no shortcuts
6. **Async verification only** -- all crypto goes through `crypto.subtle`, no synchronous `node:crypto`
7. **Use `APIError` from `better-auth/api`** -- raw `ctx.json({ error })` died in v0.4.0, let it rest
8. **Write users and accounts through `ctx.context.internalAdapter`** -- raw `ctx.context.adapter.create` skips `databaseHooks` and `user.validateUserInfo`, which is exactly the v2 bug v3 fixed. Reads via `adapter.findOne` are fine
9. **Update CHANGELOG.md** for user-facing changes -- the changelog is a love letter to your future maintainers

## Testing

I maintain 90%+ coverage. Not because I worship the metric, but because untested code is just a theory.

- **Verification**: crypto tests in `verify.test.ts` and `verify-hardening.test.ts` -- HMAC paths, replay attacks, future `auth_date`, hash format, edge cases
- **Server plugin**: `widget.integration.test.ts`, `oidc.integration.test.ts` and `identity.integration.test.ts` run a real `betterAuth()` (memory adapter, or SQLite with the schema Better Auth's migrations generate) against a fake Telegram modeled on the live one -- signin, link, unlink, Mini App, OIDC, hooks, `validateUserInfo`, identity revocation, placeholder squatting. Prefer these over mocking Better Auth: mock-only tests passed while OIDC was broken on 1.7
- **Client plugin**: mock `$fetch`, test widget init and API methods in `client.test.ts`
- **Security**: adversarial inputs, timestamp manipulation, malformed data, forged ID tokens

## Pull Request Process

1. Fork the repo and branch off `main` (not `develop`, not `feature-branch-from-six-months-ago`)
2. Write tests for your new code (yes, before the PR, not "I'll add them later")
3. Make sure absolutely everything passes:
   ```bash
   npm run type-check && npm test && npm run lint
   ```
4. Update documentation if applicable (it is applicable more often than you think)
5. Update `CHANGELOG.md` under an `[Unreleased]` section
6. Open a PR with a clear description -- "misc fixes" tells me nothing

## Reporting Issues

- **Bugs**: use the [bug report template](https://github.com/vcode-sh/better-auth-telegram/issues/new?template=bug_report.yml)
- **Features**: use the [feature request template](https://github.com/vcode-sh/better-auth-telegram/issues/new?template=feature_request.yml)
- **Security**: see [SECURITY.md](SECURITY.md) -- do NOT open a public issue for vulnerabilities unless you enjoy chaos

## Code of Conduct

There is one. It's in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). The short version: don't be awful. The long version: read the file.

## CI and releases

Node.js 24 is the minimum. The required `CI` check collects package validation, Node 24.0.0 and current 24/26 tests, the complete Better Auth 1.7.12 family, forced Bun 1.4.4 tests and real database adapters. A failed or skipped required lane fails the gate. Fork PRs run with read-only permissions.

`npm run build` checks the bundles and declarations with publint and Are The Types Wrong. `npm run test:package` packs the result, installs it outside the checkout, checks its consumer types, exercises ESM authentication configuration and loads both CommonJS exports. It leaves `better-auth-telegram-<version>.tgz` for inspection. CI uploads that tarball.

A matching `v<version>` tag on a commit belonging to `main` runs the same CI before release. Only the separate publisher receives npm OIDC permission; it publishes the validated tarball with provenance, without rebuilding or running lifecycle scripts. Stable versions use `latest`, prereleases use `next`. Creating a PR does not publish a release.
