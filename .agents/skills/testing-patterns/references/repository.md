# Repository testing reference

Paths below are relative to this reference. Run commands from the repository root.
Verify the current scripts/configuration when they change; this reference does not
override task scope or authorize installing dependencies or starting services.

## Owners and fixtures

| Claim | Owner and existing evidence |
| --- | --- |
| Signed Widget/Mini App data, freshness and canonical fields | [verify.ts](../../../../src/verify.ts), [literal vectors](../../../../src/verify.test.ts), [boundary tests](../../../../src/verify-hardening.test.ts) |
| OIDC token identity and mapping | [oidc-token.ts](../../../../src/oidc-token.ts), [oidc.ts](../../../../src/oidc.ts), co-located OIDC suites |
| Account ownership, hooks, revocation and session cookies | [account orchestration](../../../../src/telegram-account.ts), [identity hooks](../../../../src/telegram-identity.ts), [real-adapter suite](../../../../src/adapters.adapter.test.ts) |
| Client session refresh | [client.ts](../../../../src/client.ts), [real client/server tests](../../../../src/client.integration.test.ts) |
| Widget callback/host lifecycle | [client-widget.ts](../../../../src/client-widget.ts), [DOM tests](../../../../src/client.test.ts) |
| Installed exports and consumer types | [package verifier](../../../../scripts/check-package.mjs), [test-d](../../../../test-d/consumer.ts), [CommonJS consumer](../../../../test-d/commonjs.cts) |

[testing/harness.ts](../../../../src/testing/harness.ts) exposes real Better Auth on
memory or SQLite, a cookie-aware HTTP client, signed inputs and a fake Telegram
issuer. Substitute the external provider, not Better Auth's authentication decisions.
The signing helpers are input factories; literal OpenSSL vectors independently
check the cryptographic format. The fake issuer rejects unexpected network calls.
SQLite fixtures register `onTestFinished` cleanup, including setup failure.

The client integration tests use the real Better Auth store and server. Control
scheduled refresh work before asserting absence of a request; an immediate assertion
may run too early. Browser layout, iframe cookies and live Telegram login require
the corresponding acceptance environment. [test/](../../../../test/README.md) is a
manual playground, not an automated test lane.

## Selection and gates

The source of truth is [package.json](../../../../package.json),
[Vitest config](../../../../vitest.config.ts),
[adapter config](../../../../vitest.adapters.config.ts) and
[CI](../../../../.github/workflows/ci.yml). Node 24+ is required. Existing installs
are sufficient for the commands below; do not install or upgrade tools gratuitously.

```sh
# Focused default-suite cases; inspect the selected/passed/skipped counts.
npm test -- src/verify-hardening.test.ts -t 'auth_date freshness'
npm test -- src/client.integration.test.ts -t 'disableSignal'

# Scope lint while editing; type-check the package for affected TypeScript.
./node_modules/.bin/ultracite check src/verify-hardening.test.ts
npm run type-check

# Default suite and its coverage gate.
npm test
npm run test:coverage

# Bun compatibility uses Vitest under Bun, not the unrelated `bun test` runner.
bun --bun run test

# Built public declarations and an isolated installed-package consumer.
npm run build
npm run test:types
npm run test:package
```

Default tests use happy-dom unless their file selects Node. `*.adapter.test.ts` is
excluded from `npm test`; a passing default suite is not adapter evidence. Coverage
floors remain 90% lines/statements/branches and 80% functions. Broad/release CI also
requires lint, type checks, runtime dependency audit, package validation, Node 24.0.0,
current Node 24/26, the complete minimum Better Auth 1.7.17 family, Bun 1.4.4 and real
adapters. Do not infer a release pass from one local lane or bypass required checks.

Documentation/skill-only changes normally need readback, link/frontmatter validation
when relevant, and `git diff --check`; do not run the runtime matrix just for prose.
A type-contract failure is assessed through declaration consumers, not only runtime
coverage. Tests at different levels can protect different failures of one feature.

## Real adapters and resource ownership

[testing/adapters.ts](../../../../src/testing/adapters.ts),
[adapter-resources.ts](../../../../src/testing/adapter-resources.ts) and
[adapter-prisma.ts](../../../../src/testing/adapter-prisma.ts) own fixture lifecycle.
The lane requires explicit URLs to disposable, test-owned services:

- `BAT_TEST_POSTGRES_URL`: PostgreSQL, also used by Drizzle and Prisma.
- `BAT_TEST_MYSQL_URL`: MySQL; the fixture needs permission to create databases.
- `BAT_TEST_MONGODB_URL`: MongoDB replica set with direct connection support.

Missing URLs skip the corresponding lanes. An all-skipped collection is not a pass.
The checked-in CI service setup uses PostgreSQL 18, MySQL 8.4 and MongoDB 8.2 with a
replica set. There is no repository-local general container launcher; use the
workflow as the setup reference for an authorized disposable run, not guessed host
ports, shared databases or another project's commands.

Once those owned URLs are exported:

```sh
npm run test:adapters
npm run test:adapters -- src/adapters.adapter.test.ts -t 'rejects account hooks'
```

The fixtures create named `bat_*` databases, close pools and drop owned databases.
Prisma has a suite-owned database; generated clients/schemas have per-run directories
under `node_modules/.cache/better-auth-telegram-adapters` and are removed after tests.
Caller-owned harnesses still need `close()` in teardown, including failed assertions.
For a process killed before hooks finish, the coordinator must remove its identified
containers/volumes and run-specific files. Verify cleanup without deleting shared
services, all `bat_*` databases on an unverified host, or another run's cache.

Inside Better Auth transactions, use the current transaction adapter for reads.
Memory/SQLite rollback does not establish Drizzle/Prisma's default nontransactional
behavior. Generated serial/UUID IDs and independent servers need their actual
adapter lane. Existing cross-server identity uniqueness limits remain limits, not
promises supplied by containers or a process-local lock.

## Useful local decisions

- **Freshness:** the documented age window includes its endpoint. Use explicit
  boundary expectations, with literal vectors elsewhere protecting signing. A
  helper that computes the same age rule cannot be the oracle for that rule.
- **Binding refusal:** a 409 response alone misses a bad account insert that remains
  after rejection. Use valid conflicting owners and durable readback on the relevant
  nontransactional adapter. The faster memory case can remain complementary.
- **Session refresh:** keep the real store and await its scheduler; a mock notification
  call alone cannot establish that the mounted session changed.
- **Compatibility:** preserve a reviewed serialized baseline during an internal
  refactor, even if the format is quirky. A type-only public declaration change may
  need a consumer check; a documentation correction with adequate existing coverage
  may need no new test. Neither implies a blanket snapshot or structural-check ban.

## Provenance

Adapted from the supplied research reviewed 2026-11-04:
`guidelines.md` and `audit.md` in `/home/vcode/docs/research/test-quality-2026/`.
SHA-256 digests respectively:

- `0b19c15a4d1fbccbbea6f61564788fa4d9e2a1c2a1992710465faea19da8d764`
- `7bd25662e3f4964c087a30d9dd07ce49078bec0fae445945838d9aa99e9321ce`

Those external paths identify the source material; the skill does not require them
at runtime. The qualifications are incorporated in the shared core. The research
bibliography is not copied into default-loaded instructions. Historical repository
audit reports record their own scope and are not additional testing policies.
