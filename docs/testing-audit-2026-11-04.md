# Test-quality audit: 2026-11-04

Reviewed the complete suite at release commit `8d6ec81`: 323 default-suite cases,
70 adapter variants, both declaration-consumer configurations, package acceptance,
and every shared fixture. The purpose was to detect incorrect behavior, not to
fill Codecov's 16 uncovered changed lines or preserve a test count.

At the conclusion of this test-only pass, production implementation and public APIs
were unchanged. Subsequent runtime fixes belong to the separate
[deeper verification pass](deeper-verification-2026-11-04.md).

## Decisions across the whole suite

| Area and files | Decision and preserved contract |
| --- | --- |
| `client.test.ts` | Remove duplicated rendering/default/single-login cases. Replace log-count and sleep assertions with callback recovery, exact widget ownership and controlled script success/failure. Check documented server-side misuse. |
| `client.integration.test.ts` | Keep the real client/store and server. Consolidate basic wrapper checks into successful session scenarios. Challenge SDK/fragment disagreement, suppressed refresh and rejected sign-in. |
| `verify.test.ts`, `verify-hardening.test.ts` | Keep independent OpenSSL vectors, freshness boundaries and newline forgery protection. Move redundant parser/null-user assertions to their real endpoint owners. |
| `widget.integration.test.ts` | Replace no-write-spy-only checks with successful same-user SQL/session readback. Remove duplicate mapper and hook-call cases. Distinguish application refusal from a recoverable database race. |
| `miniapp.integration.test.ts` | Consolidate parsed-output/no-write coverage. Check sender identity, precise refusals, malformed user data and absent durable authentication writes. |
| `widget-mappers.integration.test.ts` | Keep async rejection and mapped-field contracts. Replace a generic non-200 placeholder assertion with the expected refusal and no persisted identity. |
| `oidc.test.ts` | Keep independently meaningful normalization, subject and mapping rules. Move credential checks to real endpoints. Replace isolated diagnostic tests with diagnostic output during a successful real login. |
| `oidc.integration.test.ts` | Require usable returning sessions, exact ownership, verified-email refusal and cached-key outage recovery. Preserve nonce/signature, key rotation, duplicate-account and hook-veto regressions. |
| `oidc-protocol.integration.test.ts` | Keep externally defined OAuth parameters, scope combinations and token checks. Exercise missing credentials through the actual request boundary. |
| `oidc-claims.integration.test.ts` | Keep the consumer's string operation and same-account result for numeric/string claims. Reviewed without changes. |
| `oidc-profile.integration.test.ts` | Check stored and cached-session output on failed profile updates. Use equal and changed Date/JSON inputs so a no-op update implementation fails. |
| `oidc-linking.integration.test.ts` | Require exact owner/refusal and unchanged durable authentication state. Add a throwing-policy case; distinguish each binding component. |
| `oidc-identity.integration.test.ts` | Consolidate duplicated lookup/cookie checks. Session-removal assertions require a successful preceding OAuth flow, so failed login cannot satisfy them. |
| `identity.integration.test.ts` | Combine unlink checks into actual loss of old-user access. Replace policy-call inspection with a policy that rejects the wrong method/action. |
| `hooks.integration.test.ts` | Keep real veto, rollback, stale-proof and distinct-identity concurrency scenarios. Their observable outcomes are meaningful. |
| `plugin-config.test.ts` | Keep documented diagnostic content and defaults. Remove equivalent malformed-input and silent-config duplicates. |
| `plugin.integration.test.ts` | Keep route/schema/config boundaries. Challenge rate windows at 59 and 61 seconds instead of testing only immediate throttling and eventual reset. |
| `better-auth-config.integration.test.ts` | Keep CSRF, linking restrictions, typed SQL IDs, bans, bearer and session contracts. Prove hidden data exists before asserting it is not disclosed. |
| `adapters.adapter.test.ts` | Keep all original real-adapter behaviors; strengthen owner/session checks with conflicting users and default linking policy. Add binding-hook refusal through nontransactional adapters. |
| `test/` | The Next.js directory is a manual Telegram playground, not an automated suite. Its setup/configuration and manual flow instructions were inspected; no live bot/browser acceptance is claimed. |
| `test-d/*`, `scripts/check-package.mjs` | Challenge erased input/output types. Add an actual `.cts` consumer. Authenticate and read back sessions through installed ESM and CommonJS bundles; invoke the installed client rather than checking only its export's existence. |

Twenty-five redundant cases were removed or consolidated. Eleven cases were added
or moved into stronger default-suite owners, including server-side client misuse.
The default suite now has 309 cases, down from 323. Three new adapter behaviors
expand across five adapters, giving 85 variants: 78 run and seven existing
capability-dependent variants remain skipped. Counts describe scope, not success.

## Fault experiments changed the review

All faults were planted in a disposable source copy and restored after each run.
The shared checkout's production source was never mutated.

The first 55 focused experiments detected 50 faults and left five survivors:

- Two client tests asserted before Better Auth's delayed refresh. Removing either
  the `disableSignal` or error guard still passed. The tests now control and drain
  the real scheduler before checking requests/store state. Both faults then fail.
- Three prewrite binding-guard removals survived memory tests because a later
  guard rejected the operation and the adapter rolled back. That result did not
  establish the prewrite guarantee. The same removals now fail the durable-state
  assertions on both Drizzle and Prisma with their default nontransactional
  configuration, even though the HTTP response remains 409.

The real-adapter binding test uses another existing user for a remapped `userId`.
A nonexistent ID could trigger a foreign-key failure and falsely appear to prove
our guard. After each database run, PostgreSQL/MySQL/MongoDB readback found no
remaining generated test databases; owned containers were then removed.

Additional successful fault checks covered wrong returned/session owners, requiring
an undocumented trusted-provider setting, and wrong conflict status on serial/UUID
columns. One initial selector selected zero tests; it supplied no evidence and was
corrected before rerunning the conflict-status experiment.

Other discriminating examples:

| Fault | Observed failure |
| --- | --- |
| Swallow a throwing policy before linking | Unauthorized account state remains, despite the later refusal; state equality fails. |
| Create a session before rejecting policy | The error/cookie assertions still look correct, but the session-row assertion fails. |
| Treat an application refusal as a database conflict | Sign-in succeeds when it must be refused. |
| Drop cached JWKS between requests | A returning user cannot sign in during an issuer-key endpoint outage. |
| Trust a mapper's unverified email | The account-ownership/refusal assertions fail. |
| Return unchanged profile data for every update | Changed Date/JSON values do not appear in the user's session. |
| Remove per-user link serialization | The concurrent different-identity test observes two links instead of one accepted link and one conflict. |
| Reset a rate-limit window after one second | Requests at 59 seconds incorrectly succeed. |
| Erase Widget/Mini App input types to `any` | The consumer's rejected-input assertions become unused. |
| Erase the returned session type to `any` | The consumer's non-any output check fails. |
| Remove the session cookie only from built CommonJS | Installed ESM works; CommonJS cannot retrieve an authenticated session. |
| Remove the installed CommonJS client actions | Export existence still holds, but the real configuration request fails. |
| Suppress the documented missing-profile diagnostic | Authentication succeeds but the application's configured diagnostic sink lacks the warning. |

These are targeted counterexamples, not an exhaustive mutation score or a proof
that no undiscovered bug exists. Production build/import failures were not counted as assertion evidence;
consumer compilation failures are the expected signal for declaration contracts. Restored code and installed-package checks pass.

## Fixture reliability

SQLite handles close after a test, including failed assertions and failed setup.
SQL fixtures drop only their generated databases after closing their pools;
Prisma's generated files and database are run-owned and cleaned up. Teardown waits
for all cleanup results before reporting errors. The fake Telegram rejects unknown
network calls and no longer overwrites explicit token issue/expiry times.

Literal crypto vectors remain independent of the fixture signer. The fake issuer
substitutes Telegram, not Better Auth, JOSE or the database behavior under test.

## Coverage gaps and limits

Coverage floors were not lowered, and no production lines were excluded. The
remaining uncovered branches were assessed rather than filled with synthetic
internal-adapter stubs:

- Missing users during late identity/profile/session synchronization are defensive
  lifecycle paths. Ordinary veto/failure behavior has real integration coverage;
  no claim is made that these rare disappearance schedules were exercised.
- Concurrent binding rechecks and conflict-recovery fast paths depend on schedules
  not all controlled by this suite. The real-adapter concurrency checks establish
  only the outcomes they execute, not universal scheduling coverage.
- The redundant missing-hash fast return is not a reason to duplicate the lower
  signature rejection contract. An exceptional `window.location` getter is not
  synthesized solely to execute its catch branch.
- The `updateUser(...) ?? user` fallback after metadata-refresh veto lacks a clear
  independent policy for the successful-login outcome. This audit does not pin
  that current output as a requirement or claim it is a confirmed production bug.

The retained memory concurrency case uses a bounded hook rendezvous to widen the
race window, then awaits both actual operations and checks their outcomes. Its
lock-removal experiment fails; it does not establish cross-server serialization.

Emulated DOM does not establish browser layout, iframe cookie policy or live
Telegram rendering. The signed fake issuer does not establish provider uptime or
live login acceptance. Cross-server first OIDC linking still has the documented
uniqueness limitation. No production bug was established by this audit.

## Verification

- `npm run test:coverage` on Node 24.22.2: 309 passed. Coverage is 98.45% lines, 98.47% statements, 95.12% branches and 100% functions.
- `npm test` on Node 26.13.0 and `bun --bun run test` on Bun 1.4.4: 309 passed in each runtime.
- Isolated installs of the complete Better Auth 1.7.12 and 1.7.16 families: type checks and all 309 default-suite cases passed in both.
- Real-adapter suite: 78 passed, seven capability-dependent variants skipped. All five adapter lanes ran. Three single-guard faults each failed on both Drizzle and Prisma; all 15 restored binding cases passed.
- `npm run lint`, `npm run type-check`, build with publint/ATTW, both declaration-consumer configurations and installed ESM/CommonJS package acceptance passed.
- All three deliberate declaration regressions compiled as packages but failed the consumer checks. Both deliberately broken CommonJS artifacts failed package acceptance; restored artifacts passed.
- A disposable fixture probe intentionally failed after opening SQLite; its next case observed the handle closed. Database readback after every adapter experiment found zero generated databases. Owned containers and temporary installs were removed.
- At the test-only audit handoff, production-file comparison against `8d6ec81` was unchanged. No mutation, coverage exclusion or threshold change remains in the repository. Largest test file: 455 code lines; largest shared fixture: 184.

The method and current primary sources are in [Testing standards](testing.md),
including the 2026 study's distinction between triggering a fault and asserting
its consequence.
