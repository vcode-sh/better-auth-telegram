# Testing standards

A test earns its place by detecting a plausible violation of a requirement.
Executing code, preserving a test count, and increasing coverage are not goals.
These rules apply to new tests and to reviews of existing tests.

## Decide what the test proves

Before changing a test, identify the observable contract, where its expected
result comes from, and a plausible wrong implementation it must reject. A short
test name or comment is enough; do not add a repeated checklist to every case.

Expected results come from a documented API, a consumer requirement, an incident,
or an independently checked example. They do not come from running today's code.
Do not calculate expectations with the production helper or copy its algorithm.
Cryptographic fixtures need literal independently derived vectors as well as
signed integration fixtures: an encoder and verifier can share the same defect.

Choose inputs where the correct and incorrect behaviors differ. Examples here:

- An identity match must return the intended existing user, including when a
  different user is also present. A row count of one is insufficient.
- A rejected sign-in must return the expected error and create no session. Check
  durable rows when the contract forbids writes; lack of a cookie alone does not
  establish that no session was created.
- A returning sign-in must succeed with the right session and profile. Unchanged
  database rows alone also pass if the second request did nothing.
- A stale widget's cleanup must not remove its replacement's callback. Invoke the
  replacement and observe the result instead of inspecting a callback name alone.
- Time limits need inputs on both sides of the documented boundary. Freeze time
  deliberately; do not freeze the property a concurrency or uniqueness test claims
  to measure.

## Keep the behavior owner real

| Risk | Smallest credible boundary |
| --- | --- |
| HMAC format, ordering, freshness | Direct verifier with independent vectors and boundary inputs |
| User/account ownership, authorization, hooks, cookies | Real Better Auth request and response, with database/session readback |
| SQL constraints, rollback, driver behavior, concurrent servers | Disposable real database through the affected adapter |
| Client session refresh | Real Better Auth client store and controlled HTTP boundary |
| Widget lifecycle | Real DOM operations with controlled external script events |
| Package entrypoints and declarations | Built tarball installed outside the checkout, runtime calls and consumer type checks |

Mocks are appropriate at the external provider or network boundary. Request
assertions are useful when they enforce Telegram's protocol, not when they merely
repeat an internal call. A fake database cannot prove a transaction; a mocked
session store cannot prove refresh behavior. DOM emulation cannot prove browser
layout, iframe cookie policy or Telegram's live UI. Report those limits.

## Remove tests that do not discriminate

Delete a case when its unique contract cannot be established or another test
already protects the same failure. A deletion does not require a replacement.
Keep incident regressions unless their exact protection demonstrably survives
elsewhere.

Common deletion or rewrite candidates:

- Calling a function and asserting only `toBeDefined`, truthiness, no throw, or an
  unqualified mock call. These assertions can support a stronger test, but rarely
  establish the behavior by themselves.
- Returning a value from a mock and expecting the same value without checking any
  transformation or external contract.
- Source-text, file-presence, internal object-shape or export-existence assertions
  presented as runtime correctness. Genuine packaging and type contracts belong in
  the installed-consumer checks.
- Log-count assertions when the actual requirement is recovery or refusal.
  Documented startup diagnostics are observable output and can have direct tests.
- Cases that differ only cosmetically, impossible typed states at a trusted
  boundary, or fixtures where both branches yield the same expected value.

Untrusted HTTP and provider data can violate TypeScript types. Malformed inputs
are meaningful at those boundaries. Do not use the type checker as a reason to
remove their validation tests.

## Challenge the assertions

For new or rewritten authentication, identity, privacy, or concurrency cases,
check a concrete fault: remove the relevant guard, select the wrong owner, omit
an awaited mapper, or suppress the promised state transition. Run only the test
that claims to catch it, and inspect the failure reason.

Use a disposable source copy for fault injection when other sessions share the
checkout. Restore every fault before another experiment. A failed import, syntax
error, unselected test or unrelated failure is not evidence that the assertion
caught the defect. A surviving fault requires investigation: the test may be weak,
the change may be behaviorally equivalent, or the expectation may lack a contract.
Do not replace a surviving fault with an easier one just to obtain a green report.

Targeted fault experiments are evidence, not a mutation-score target or a proof
of all possible correctness. They cannot discover a requirement absent from both
implementation and tests. For a wide input space, use a small boundary table or
properties with reproducible counterexamples when justified; do not install a new
framework merely to generate more cases.

For an actual bug, first reproduce the contract violation with a focused failing
test. Do not change an expectation to bless incorrect output. During a test-only
audit, report a discovered production bug and its reproducer separately rather
than silently changing runtime behavior or deleting the failing requirement.

## Isolation and completion

Await explicit events, promises, or bounded observable outcomes. Do not use sleep
to guess when a callback or concurrent operation has finished. Unexpected network
requests must fail the test instead of reaching the real provider. Restore clocks,
globals, mocks and listeners; close SQLite handles, servers and database pools.
Release test-owned databases and generated fixtures after success or failure.
Never use shared development or production databases for these tests.

Run the affected files while iterating. On the final tree, run each applicable
[project gate](../CONTRIBUTING.md#ci-and-releases) once. Preserve useful evidence
until the code, fixtures, environment or toolchain it depends on changes. Report
actual passes, intentional skips, the faults detected and boundaries not exercised.

Coverage is a map for finding unexamined risks. Inspect uncovered lines and
branches, but do not add unreachable scenarios, duplicate tests or exclusions to
improve the number. Keep the existing coverage floors; if removing weak tests
exposes a real gap, address that behavior. A coverage comment is not itself a test
requirement.

## Sources checked on 2026-11-04

- [Vitest: Writing Tests with AI](https://vitest.dev/guide/learn/writing-tests-with-ai)
  and [Testing in Practice](https://vitest.dev/guide/learn/testing-in-practice):
  review generated assertions and test observable contracts rather than internals.
- [Vitest: Mocking Requests](https://vitest.dev/guide/mocking/requests): fail on
  unhandled external requests and reset handlers between tests.
- [Google: Code Coverage Best Practices](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html):
  coverage measures execution, and chasing 100% can produce low-value tests.
  This is established guidance, not a new 2026 rule.
- [Stryker: Mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)
  and [Equivalent mutants](https://stryker-mutator.io/docs/mutation-testing-elements/equivalent-mutants/):
  distinguish detected defects, survivors, invalid mutations and equivalent changes.
- [fast-check: Why property-based testing](https://fast-check.dev/docs/introduction/why-property-based/):
  generated inputs are useful when paired with a meaningful property, shrinking
  and reproducible failures, not as random-data volume.
- [Hamidi et al., September 2026 preprint](https://arxiv.org/abs/2609.09315):
  in its LLM-generated-code benchmark, weak test oracles limited actual fault
  detection even when faults were exercised. This is evidence from that study,
  not a claim that every project or generated test has the same defect rate.

The review method also follows the user's established `testing-patterns`
conventions: independent expectations, the real behavior owner, named defects,
and removal of tests without unique protection.

The [2026-11-04 audit](testing-audit-2026-11-04.md) records the first complete application of these rules to this repository.
