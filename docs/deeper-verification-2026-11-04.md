# Deeper functional verification: 2026-11-04

This pass follows the [test-quality audit](testing-audit-2026-11-04.md). Its scope
includes production corrections with independently reproduced failures, not just
test cleanup. The previous test changes remain in the working tree.

## Confirmed defects and fixes

| Contract | Failure reproduced before the fix | Correction |
| --- | --- | --- |
| A newer widget initialization owns its host | A late older configuration replaced the current bot and callback | Per-host request ownership prevents stale rendering; superseded handles are harmless |
| Invalid OIDC identity must not reach application mapping | Empty/numeric signed `sub` reached the mapper or caused HTTP 500 | Check the existing nonempty-string invariant immediately after cryptographic verification |
| Opaque subjects must not depend on email syntax | Valid punctuation caused HTTP 500, while long subjects/collision variants exceeded the local-part limit | Use a bounded derived email label only when needed, preserving raw account keys and unlink separation |
| The public audience type is a string | A valid single-client audience array caused `claims.aud.trim()` to throw | Normalize the already-accepted audience to the configured client ID |
| Mini App verification and parsing describe the same data | An appended second `hash` was ignored by verification but returned by parsing | Reject duplicate decoded parameter names before verification |
| Numeric Telegram IDs preserve their identity | Nonpositive, fractional and unsafe numeric IDs could be provisioned; large JSON numbers lost precision | Require positive safe integers, retaining valid 52-bit controls |
| A Telegram account key has one unambiguous owner | Widget/Mini App sign-in chose the first of conflicting owners | Reject different owners while preserving same-owner legacy duplicates, including a hidden third conflicting row |
| Application work cannot leave stale account proof in use | Revocation/reassignment during validation, or revocation during profile updates, still allowed a new session | Recheck ownership after validation and after profile writes before continuing |

The signed-malformed-token cases require an issuer signature; the tests do not
establish an attacker-forged-token bypass. The duplicate-hash case changes parsed
metadata without the bot secret, but does not establish forged user identity.
Conflicting ownership requires inconsistent stored records, such as legacy or
concurrent writes. These are concrete correctness failures, not an asserted live
account-takeover incident.

## Boundaries kept real

Regression tests exercise real Better Auth requests, signed provider responses,
DOM callback ownership and database/session results. Ownership checks also run
against PostgreSQL, MySQL, MongoDB, Drizzle and Prisma. Same-owner duplicate
compatibility and serial/UUID identifiers stay under the existing adapter matrix.

The widget scenario controls configuration response order rather than sleeping.
The account-policy and metadata-hook cases change the actual stored account and
check that no new session was issued. Positive controls retain valid sign-in,
large representable IDs and the existing account owner.

## Measured cost

The first correctness implementation made four account reads for an unchanged
returning sign-in. The bounded two-row fast path reduces that to two: one lookup
before application validation and one recheck afterward. The separate conflicting-
owner query is needed only when duplicate rows are found. A fixture with two
same-owner rows followed by a conflicting third row prevents this optimization
from silently ignoring an owner.

These are measured adapter-operation counts, not a claim of end-to-end database
latency improvement over the released version, which lacked the new recheck.
Metadata writes require another authority check after their hooks.

A warm Bun 1.4.4 microbenchmark ran 1,000 HMAC verifications per flow: roughly
0.010 ms mean for Widget and 0.015 ms for Mini App. This does not include network,
database or cold-start costs. No cryptographic cache or GPU machinery was added;
these measurements do not justify the extra state or complexity.

## Remaining limits

- This is not a database-wide uniqueness constraint or a distributed revocation
  protocol. Checks do not revoke existing sessions or establish universal ordering
  against other server instances or arbitrary session-creation hooks.
- Direct-token sign-in verifies the signature twice through Better Auth's
  verification/profile phases. No shared verification cache was added without a
  demonstrated workload bottleneck and a proved request/nonce ownership design.
- Browser layout, Telegram-hosted rendering, iframe cookie policy and a new live
  Telegram login were not exercised. Controlled protocol tests do not substitute
  for that acceptance.

## Verification

- Default suite: 336 tests pass on Node 24.22.2, Node 26.13.0 and Bun 1.4.4.
- Complete Better Auth 1.7.12 and 1.7.16 families: type checks and all 336 default-suite cases pass in isolated installs.
- Real databases: 98 tests pass across PostgreSQL/Kysely, MySQL/Kysely, MongoDB, Drizzle and Prisma; seven existing capability-dependent variants are skipped. This includes revocation in validation and profile hooks, conflicting owners and opaque-subject persistence.
- Lint, type checks, build with publint/ATTW, declaration consumers and installed ESM/CommonJS authentication/session checks pass.
- Coverage: 98.55% lines, 98.57% statements, 95.63% branches and 100% functions. Thresholds and exclusions remain unchanged.
- Eight isolated fault reversals fail the intended new assertions: stale rendering, late subject validation, raw audience arrays, duplicate fields, unsafe IDs, hidden third owners, stale policy proof and stale profile proof. Restored regressions pass.
- Placeholder fault experiments also detect direct use of unsafe subjects, reuse of an unlinked owner's email, and alteration of the original account key. An initially unmatched selector supplied no evidence; the corrected selector fails the account-key assertion.
- Disposable database readback finds no remaining generated databases. Containers and temporary dependency installs are removed after verification.
- Largest implementation module: 187 non-comment code lines. Largest test file: 466.

## 3.2.1 release follow-up

Codecov identified an untested authority check when the user profile is already
current but the Telegram account metadata still needs updating. The profile-hook
regression now covers that state as well as the original stale-profile case,
checking the refusal code, removed account, unchanged stored sessions and absence
of an authenticated cookie. Removing only this authority check in an isolated
copy makes the new case fail with HTTP 200 instead of 401; restoring it passes.
No production change was needed. The temporary copy was removed.

The updated default suite passes all 337 tests on Node 26.13.0. Coverage is 98.68%
lines, 98.70% statements, 95.78% branches and 100% functions; the affected account
module has 100% line coverage. Scoped lint, package type checks and diff checks
also pass. These results supplement the earlier runtime/adapter matrix; release
CI checks the new test on every required runtime without weakening existing gates.

No test claims that this finite review proves the absence of every possible defect.
No release or production deployment is part of this working-tree verification.
