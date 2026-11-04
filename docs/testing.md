# Testing standards

The authoritative instructions are the repository-local
[testing-patterns skill](../.agents/skills/testing-patterns/SKILL.md).
[Repository guidance](../.agents/skills/testing-patterns/references/repository.md)
contains verified commands, behavior owners, fixture isolation, cleanup and examples.

Codex discovers `.agents/skills/testing-patterns/SKILL.md` and accepts
`$testing-patterns`. Claude Code discovers the relative directory symlink at
`.claude/skills/testing-patterns` and accepts `/testing-patterns`. Both use one body;
no plugin, global installation or host-specific frontmatter is required.

[Validation evidence](../.agents/skills/testing-patterns/references/validation.md)
records client discovery, representative decisions and the limits of those checks.

The skill is adapted from the supplied 2026 research, preserving its qualifications:
meaningful contracts and deliberate baselines, proportional failure evidence,
legitimate doubles/structural checks, complementary test levels, and no universal
test or mutation quota. Source identifiers and hashes are in the reference.

Historical evidence remains in the [test-quality audit](testing-audit-2026-11-04.md)
and [deeper verification report](deeper-verification-2026-11-04.md). These describe
completed work and its limits; they do not require repeating that work for each edit.
