# Repository instructions

Read [CLAUDE.md](CLAUDE.md) for architecture and commands.

For test authoring, review, pruning or verification decisions, use the shared
[testing-patterns skill](.agents/skills/testing-patterns/SKILL.md).

Keep code, documentation and comments in English. Keep implementation modules
focused (aim for at most 200 code lines) and test files under 600 code lines;
comments do not count toward those limits. Preserve public package entrypoints.

Use isolated test-owned databases and release all resources after success,
failure or cancellation. Never mutate shared development or production data.
