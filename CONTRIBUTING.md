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
- npm 11.18.0 (the version used in CI)

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
npm run test:coverage # Coverage report -- inspect gaps; do not optimize the number
npm run test:adapters # Real PostgreSQL / MySQL / MongoDB (Docker); databases without a BAT_TEST_*_URL are skipped, see vitest.adapters.config.ts
npm run lint         # Biome lint check -- it has opinions and they are correct
npm run lint:fix     # Auto-fix -- let the machine do the boring part
```

## Project Structure

```
src/
  index.ts                   Public server plugin entry
  client.ts                  Public client plugin entry and API actions
  client-widget.ts           Browser widget lifecycle and widget option types
  client-types.ts            Client response and user types
  plugin-config.ts           Option parsing, defaults, startup warnings
  schema.ts                  Conditional user/account schema fields
  widget-endpoints.ts        /telegram/signin, /telegram/link, /telegram/unlink
  miniapp-endpoints.ts       /telegram/miniapp/signin, /telegram/miniapp/validate
  config-endpoint.ts         /telegram/config
  telegram-account.ts        Find-or-create orchestration
  telegram-account-state.ts  Shared account types, lookups, validation and locks
  telegram-account-user.ts   User provisioning and returning-user refresh
  telegram-account-link.ts   Explicit account link/unlink
  telegram-session.ts        Session creation and cookie refresh
  oidc.ts                    Telegram OIDC provider factory
  oidc-token.ts              JWKS/token verification and claim normalization
  oidc-linking.ts            Match verified identity before OIDC account lookup
  oidc-linking-policy.ts     Linked identity proof and application validation
  telegram-identity.ts       Database hook registration
  telegram-identity-state.ts Verified request claims and changed-user tracking
  telegram-identity-sync.ts  Copy/reconcile identity on users and accounts
  telegram-identity-session.ts OIDC session-cookie refresh
  telegram-profile.ts        Mapped profile updates
  telegram-placeholder.ts    Placeholder reservation and OIDC email selection
  verify.ts                  HMAC-SHA256 verification via Web Crypto API
  types.ts                   Public server types
  constants.ts               Error codes, defaults, provider IDs and endpoints
  testing/harness.ts         Stable imports for shared test fixtures
  testing/auth.ts            Real Better Auth on memory or SQLite
  testing/http-client.ts     Cookie-aware test client
  testing/signed-data.ts     Signed Widget and Mini App fixtures
  testing/oidc-server.ts     Fake oauth.telegram.org server
  testing/oidc-flow.ts       OIDC claims and complete sign-in helpers
  testing/constants.ts       Independent fixture constants
  testing/adapters.ts        Real database adapter fixtures
  *.test.ts                  Co-located unit tests
  *.integration.test.ts      Tests against a real Better Auth instance
test-d/                      Type tests for consumers of dist/
```

The package still exposes only `better-auth-telegram` and `better-auth-telegram/client`. Supporting modules are internal; consumers should not import their paths.

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

Follow [Testing standards](docs/testing.md). Each test must distinguish a requirement from a plausible defect. Delete cases with no unique protection; do not retain them for a coverage target or test count.

- **Verification**: crypto tests in `verify.test.ts` and `verify-hardening.test.ts` -- HMAC paths, replay attacks, future `auth_date`, hash format, edge cases
- **Server plugin**: `widget.integration.test.ts`, `miniapp.integration.test.ts` and `widget-mappers.integration.test.ts` cover Widget/Mini App sign-in, account changes and mapping. OIDC suites are grouped by behavior: `oidc.integration.test.ts`, `oidc-protocol.integration.test.ts`, `oidc-identity.integration.test.ts`, `oidc-profile.integration.test.ts`, `oidc-claims.integration.test.ts` and `oidc-linking.integration.test.ts`. `identity.integration.test.ts` and `hooks.integration.test.ts` cover revocation, placeholders and application hooks. These use real `betterAuth()` instances (memory or SQLite) and a fake Telegram modeled on the live one. Prefer them over mocking Better Auth: mock-only tests passed while OIDC was broken on 1.7
- **Client plugin**: exercise widget behavior through the DOM and session refresh through the real Better Auth client store. Control the external HTTP/script boundary; do not replace the behavior being tested.
- **Security**: adversarial inputs, timestamp manipulation, malformed data, forged ID tokens

## Pull Request Process

1. Fork the repo and branch off `main` (not `develop`, not `feature-branch-from-six-months-ago`)
2. Add or strengthen tests only for changed behavior or a concrete uncovered risk; follow [Testing standards](docs/testing.md).
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

Codecov uses the same 90% coverage floor as Vitest. Coverage is a guardrail; add tests that challenge observable behavior rather than tests whose only purpose is reaching 100%.
