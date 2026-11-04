# Skill validation, 2026-11-04

This is a record of bounded checks, not an additional testing policy or a claim
about the correctness of the repository's authentication implementation.

## Discovery and portability

Installed clients were `codex-cli 0.166.0` and Claude Code `2.1.318` on Linux.
The official [Codex skills documentation](https://learn.chatgpt.com/docs/build-skills)
and [Claude Code skills documentation](https://code.claude.com/docs/en/skills)
describe their respective discovery directories and support directory symlinks.
The shared core has only portable `name` and `description` frontmatter.

- The installed Codex `app-server` answered `skills/list` with `forceReload: true`
  for the repository root and `src/`. Each returned exactly one enabled,
  repository-scoped `testing-patterns` at `.agents/skills/testing-patterns/SKILL.md`,
  with no discovery errors. The server process was then terminated.
- A Claude Code provider evaluation selected the skill through its native `Skill`
  tool: input `{"skill":"testing-patterns"}`, successful command `testing-patterns`.
  This exercised actual invocation through `.claude/skills/testing-patterns`.
- The relative directory link is `../../.agents/skills/testing-patterns`.
  Both paths resolve to the same instruction body. A disposable Git index and
  `git checkout-index` roundtrip preserved mode `120000` and a working relative
  link. `AGENTS.md` and `CLAUDE.md` are distinct regular files.

Codex invocation is `$testing-patterns`; Claude Code invocation is
`/testing-patterns`. No plugin wrapper, MCP server, hooks or global installation
was added. The interactive slash-command menu was not separately exercised.
Checkout portability was checked on Linux, not Windows or macOS.

## Behavioral checks

Each client received the same four tasks in its own disposable fixture directory.
The prompts supplied the contract and allowed edits, but not the evaluator's
expected decisions or mutation checks. Agents were directed to use applicable
repository instructions; the four fixture tasks themselves did not name a skill.

The Codex native subagent read the shared skill and repository reference. The
Claude Code provider used the native skill tool; it did not load the optional
reference because the fixtures explicitly selected Node's built-in test runner.
These are behavioral smoke checks, not a benchmark or exhaustive trigger test.

| Task | Observable outcome in both clients |
| --- | --- |
| Inclusive freshness threshold, with a mirrored interior-only test | Replaced the computed oracle with literal contract examples, added the exact endpoint and an expired case, observed an assertion failure on the endpoint, then fixed the fixture. |
| Final-seat reservation with a fake SQL transaction | Identified that two mocked writes do not establish one successful reservation; required coordinated independent PostgreSQL transactions and durable readback. Did not provision a database or edit the scenario. |
| Reviewed double-space label golden before an internal refactor | Kept the baseline and test unchanged; distinguished compatibility from ideal formatting. |
| README spelling correction | Corrected the word and added no test. |

Both clients observed RED with two passing cases and one failed assertion, then
GREEN with three passing cases. The lead independently ran each resulting test,
reintroduced the original `<` instead of `<=` defect, and observed exit 1 with an
`AssertionError`. Restoring the fix and running the freshness and compatibility
tests together gave exit 0. Node was `v26.13.0`.

Fixture commands actually executed included:

```sh
node --test regression/freshness.test.mjs
node --test regression/freshness.test.mjs compat/format.test.mjs
```

Hash comparisons found only the four allowed fixture outputs changed: freshness
implementation, freshness test, README and result report. The boundary scenario,
golden and compatibility test stayed unchanged. Evaluators made no changes to the
real tracked repository files or the shared skill/reference.

## Structural checks and local command verification

- The installed skill-creator `scripts/quick_validate.py` accepted the canonical
  directory. Relative Markdown links, code fences, skill name and symlink target
  were checked. `git diff --check` passed.
- Commands in [repository guidance](repository.md) were checked against local
  package scripts, Vitest configuration, fixtures and CI. This source verification
  does not mean the full commands or runtime matrix were executed for this task.
- `vitest list src/verify-hardening.test.ts -t 'auth_date freshness' --json=...`
  found two static test templates; parameterized cases were not expanded.
- `vitest list src/client.integration.test.ts -t 'disableSignal' --json=...`
  found one static test.
- The adapter selector `rejects account hooks` exists in the source. Both static
  and `--staticParse=false` collection with `vitest.adapters.config.ts` returned
  zero cases while all three `BAT_TEST_*_URL` variables were explicitly unset.
  That is not a passing adapter run or proof of the selected runtime case.

No repository runtime suite, real adapter, browser acceptance or release matrix was
run for this instruction-only change. Existing CI gates, production code, tests,
dependencies and package scripts were preserved.

## Cleanup

Evaluation-owned fixtures, logs and nested checkout/index probes under
`node_modules/.cache/testing-skill-eval-mmuar67i` were removed after recording these
results. No database, container or persistent server was created. Unrelated caches,
services and work were left intact. The evidence above is retained as a summary;
temporary model traces and fixtures are not part of the skill distribution.
