---
name: testing-patterns
description: "Write, review, or prune better-auth-telegram tests; choose justified expectations, fixtures, behavior boundaries, and verification effort. Use when deciding whether a test adds protection. Does not authorize a general code audit, suite cleanup, or runtime changes."
---

# Tests that earn their place

Protect a justified contract or deliberate compatibility baseline, distinguish a
meaningful failure, and weigh the additional protection against maintenance cost.
Stay within the task. A small edit does not require a full audit or testing plan.
Read [repository guidance](references/repository.md) when choosing a local runner,
fixture, dependency boundary, or required gate.

## Establish the claim

Read the relevant implementation, callers and existing protection. Identify the
contract and its provenance, a plausible failure class, the behavior owner, and
what the proposed test adds. Usually the test name or a short explanation is enough.
If existing tests and static checks adequately protect the task, add no new test.

Requirements, protocol examples, checked calculations, domain properties and
reviewed references can justify expected results. Current implementation is useful
but fallible evidence; do not use the calculation under test as its own oracle.
Shared setup and unrelated parsing helpers can be legitimate. A recorded legacy
output can protect compatibility during a refactor: label and review that baseline
without claiming it proves business correctness. If the contract is unknown, keep
the uncertainty visible rather than inventing an expectation.

## Make the case discriminate

Choose reachable inputs, relevant boundaries, roles, states or combinations that
separate the contract from the named mistake. Run the actual behavior owner.
Assert promised outputs and relevant effects: identities, durable state, external
requests, user-visible results, errors and prohibited actions. A denial must reach
the intended decision; invalid setup or an unawaited operation can make it vacuous.
Be precise about important fields without freezing unrelated output.

Use the narrowest boundary that preserves the failure mechanism. Real database
engines are needed for claims about their constraints, transactions or locking;
a substitute does not establish those semantics. A real dependency is not required
for every test that happens to call it. Client-store behavior needs the real store;
DOM emulation does not establish browser layout or Telegram's live behavior.
Complementary unit, integration, contract and acceptance tests may overlap usefully.

Mocks and fakes can control external responses, time, rare errors or expensive
collaborators. Interaction assertions can protect request contracts, forbidden
calls, duplication limits or ordering. Reviewed snapshots/goldens can protect
formats or visual baselines; source/architecture checks can enforce an explicit
structural policy. Type, presence and smoke checks can protect limited interface
or startup contracts. Judge their purpose, not their syntax; do not ban these
techniques or present them as stronger evidence than they supply.

## Check sensitivity proportionately

For a confirmed bug, prefer a focused failing regression before the fix when RED
is stable and economical. Inspect why it fails. For a doubtful assertion or an
important invariant, consider a targeted fault or mutation when it adds useful
confidence. Do not impose mutation on every test, a universal coverage target,
mandatory separate-model review, or a new testing dependency.

A killed mutant does not validate the oracle. A survivor may be equivalent,
irrelevant, unreachable or evidence of weak protection. A broken build/import or
unselected case is not behavioral detection; an intentional consumer-type failure
can be the correct signal for a declaration contract. Restore only your own probes
and verify the resulting tree. Use an isolated copy when work is shared.

Generated inputs need a useful domain and property, reviewed preconditions/filters,
and reproducible failures. Round trips can hide mutually cancelling faults;
differential agreement depends on a fallible reference. Retain independent examples
where they protect another dimension. No technique is mandatory for every function.

## Decide and finish

For an authorized test review, use:

- **KEEP:** useful contract, reviewed baseline or distinct boundary at acceptable cost.
- **REWRITE:** meaningful risk, but inadequate oracle, fixture, boundary or reliability.
- **DELETE:** obsolete/no useful role, or equivalent relevant protection remains;
  inspect callers, incident coverage, fixtures, registrations and required gates first.
- **UNRESOLVED:** insufficient contract or evidence; retain the test pending investigation.

Equal coverage or mutation scores do not prove equivalent future protection. Do not
prune to a count target. "Confirmation testing" can legitimately mean verifying a
bug fix; describe weak cases as implementation-mirroring or weak-oracle tests.

Await work and eventual assertions. Coordinate races at the relevant boundary
where practical; do not rely only on simultaneous promise creation. Prefer bounded
observable waits to guessed sleeps, and investigate intermittent product failures
instead of hiding them with retries. Any quarantine needs a reason, owner and path
back to coverage. Restore clocks, listeners, mocks and owned state; release owned
files, connections, processes and containers on failure, cancellation and timeout.

Preserve the project's required gates, including surface acceptance when applicable.
Use the smallest relevant checks and reuse valid evidence until its assumptions
change. Coverage is a diagnostic, not a correctness certificate: do not lower gates,
exclude code or weaken assertions for a score. Report decisions, checks actually run,
unproved boundaries and cleanup; distinguish observation from prediction.
