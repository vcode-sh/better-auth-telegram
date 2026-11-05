# Issue #53: authentication flow challenge and repairs

Date: 2026-11-05. Starting commit: `2c8f39ef87afd1b7e7fcfcdc7cc9035ca49f4f4f`.
The issue and all comments were read, including the reporter's latest
[`input: false` follow-up](https://github.com/vcode-sh/better-auth-telegram/issues/53#issuecomment-6652246775).
This report describes the initial local changes and checks, before the subsequent live device acceptance. See [the live follow-up](live-acceptance-2026-11-05.md) for actual Telegram callbacks, recordings and the corrected distinction between creation-time user fields and per-sign-in session claims. No release was published.

## The latest report has a different cause

The reporter confirmed the async mapper fix works in 3.1.1 and 3.2.1. Their new
configuration marks application fields as `input: false`. Better Auth deliberately
filters those values out of provider mapper results, including in stateless mode.
`returned: true` exposes an already stored value; it does not populate the field.
The same rule exists in the inspected 1.7.12, 1.7.14 and 1.7.17 sources.

Changing the mapper to bypass this rule, or enabling client input for application
IDs and roles, would undermine the documented boundary. The repair to our guidance
is a complete [trusted-field recipe](server-owned-fields.md), with an application
lookup in `validateUserInfo`, request-local state, and a `user.create.before` hook.
No `customSession` is needed. Required server-owned fields must not be rejected by
the earlier provider parser before that hook can supply them.

The executable example checks the JWT itself and session readback on a second
auth instance, rejects generic user updates, refuses unknown members, and separates
two overlapping sign-ins at a controlled creation-hook barrier. It also explicitly
disables stateless rolling refresh and verifies the session expires: Better Auth
otherwise enables cookie refresh by default without a database, without repeating
the application membership lookup.

## Confirmed defects and fixes

| Reachable failure | Fix | Discriminating evidence |
| --- | --- | --- |
| A revoked session remained in cookie cache and could link or unlink Telegram. | Authoritative session middleware for both routes; freshness still enforced for unlink. | SQLite, a second device revoking the session, a still-readable cached session, then 401 and unchanged accounts. Both operations returned 200 before the fix. |
| Better Auth 1.7.14 allowed OIDC linking from revoked cached sessions, and completed a redirect after its initiating session was revoked. | Raise both peers and the complete development family to 1.7.17; update CI minimum and installation instructions. | Three failing cases on 1.7.14, all four cases including the live-session control passing on isolated 1.7.17. |
| Returning OIDC login could issue a session after validation or profile-update hooks removed its account; a creation hook could remove a new account with the same result. | Remember the expected account owner in request state and recheck its proof after hooks, before session storage. Apply in OIDC-only mode too. | Failing-first callback/direct-token cases, first-sign-in and profile-hook cases; real-adapter creation-hook regression. Unrelated nested sessions still succeed. |
| The new ownership snapshot initially moved duplicate-account failure outside Better Auth's redirect error handling. | Snapshot only an unambiguous owner and let Better Auth perform its authoritative duplicate rejection. | Existing duplicate-account test caught 500 instead of 302; it passes with no session or new account after repair. |
| A widget failed to initialize with global `fetchOptions.throw: true`. | Request an explicit response envelope for the widget's internal config fetch. | Real Better Auth client and server in a DOM test: successful config previously still threw. |
| Generated `authClient.telegram.unlink()` sent GET to a POST-only endpoint. | Declare the client's route method. | Generated client call previously returned 404; it now removes the link without a dummy body. |

The server-owned mapper filter itself remains unchanged. Public package entrypoints
remain unchanged. There is no plugin schema migration. Consumers must upgrade
`better-auth` and `@better-auth/core` together to `>=1.7.17 <1.8.0`.

## Scope inspected

Three independent review lanes and central integration covered:

- OIDC token verification, claim normalization, nonce, issuer/audience/subject,
  algorithms, JWKS caching and rotation, token exchange, provider mapping,
  registration, configuration and public types.
- Account creation and lookup, ownership, explicit and implicit linking,
  placeholder collisions, hook vetoes, revocation, identity reconciliation,
  database adapter boundaries, session issuance and cookie refresh.
- Widget and Mini App canonicalization, freshness, input structure, CSRF,
  conditional endpoints, mapper awaiting, client notifications, generated routes,
  widget replacement races and teardown.
- Documentation and dependency contracts against current official sources and
  installed/tagged Better Auth implementation. Existing historical audit reports
  were retained as historical evidence, not rewritten as current guarantees.

## Verification

| Check | Observed result |
| --- | --- |
| Node 26.13.0 full suite with coverage | 357 passed; thresholds passed: 98.69% lines, 96% branches, 100% functions. |
| Node 24.0.0, Node 24.22.2, Bun 1.4.4 full suites | 356 passed in each lane on the same final runtime implementation. The subsequently added recipe-expiry test and final recipe fixture were also checked on Node 26.13.0, Node 24.22.2 and Bun: 5 recipe tests passed per lane. |
| Real adapters | 103 passed, 7 pre-existing capability-dependent skips. PostgreSQL 18/Kysely, MySQL 8.4/Kysely, MongoDB 8.2 replica set, Drizzle/PostgreSQL and Prisma/PostgreSQL. |
| Type checks | Source plus built bundler/Node16 consumers passed, including the new documented recipe. |
| Lint and whitespace | Passed. |
| Build and package shape | ESM/CJS build, declaration output, publint and Are The Types Wrong passed. |
| Installed tarball | Isolated ESM/CommonJS consumers, signed login and consumer types passed. |
| Dependency graph/audit | Complete Better Auth 1.7.17 family verified; runtime audit reported zero vulnerabilities. |

The adapter skips are existing exclusions for unsupported two-server and generated-ID
fixture capabilities, not missing database URLs. The new account-revocation case
ran in every adapter lane. Both sets of disposable database containers, temporary
runtime downloads, the dependency comparison fixture, generated adapter resources
and installed-package consumers were cleaned up. Shared databases were not used.

The attempted `npm exec --package=node@24` invocation was discovered to resolve the
host Node 26 binary with the installed npm 12.2.1. It was not counted as Node 24
evidence: the actual lanes used the explicit installed Node 24.22.2 binary and an
SHA-256-checked official Node 24.0.0 download, printing their versions first.

## Limits

This is a source and executable behavior review, not proof that no defects remain.
The Telegram issuer is a signed local fixture; live Telegram/BotFather consent,
actual browser rendering and third-party iframe cookies were not exercised.

The ownership recheck closes the reproduced application-hook windows. It does not
make account revocation and session creation a distributed atomic transaction.
Existing limits around cross-instance identity uniqueness, nontransactional
partial writes, previously issued sessions and cache freshness remain documented
in [Security](security.md). Stateless JWT claims remain snapshots, so immediate
permission revocation belongs in the application's current authorization checks.

No commit, push, publication or GitHub comment was made. Pre-existing AGENTS.md,
CLAUDE.md and `.entire/` work was preserved; CLAUDE.md additionally received the
current dependency baseline and authoritative-session guidance.

## Primary references

- [Better Auth provider mapping and server-owned fields](https://better-auth.com/docs/concepts/oauth#server-owned-fields-and-authorization-claims)
- [Better Auth database hooks](https://better-auth.com/docs/concepts/database#database-hooks)
- [Better Auth 1.7.16 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.16)
- [Better Auth 1.7.17 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.17)
- [Better Auth changes from 1.7.14 to 1.7.17](https://github.com/better-auth/better-auth/compare/v1.7.14...v1.7.17)
- [Better Auth client fetch options](https://better-auth.com/docs/concepts/client#fetch-options)
- [Telegram OIDC](https://core.telegram.org/bots/telegram-login)
- [Telegram legacy Login Widget verification](https://core.telegram.org/widgets/login-legacy#checking-authorization)
- [Telegram Mini App verification](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
