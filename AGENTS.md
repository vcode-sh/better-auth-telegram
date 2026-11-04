# Repository instructions

Read [CLAUDE.md](CLAUDE.md) for architecture and commands.

For every test change, apply [Testing standards](docs/testing.md). Tests must
challenge a named, plausible defect using independently established expected
behavior. Keep the behavior owner real, delete redundant or confirmation-only
cases, and validate authentication assertions with focused fault experiments.
Coverage and test counts are evidence, not goals. Do not change runtime behavior
during a test-only audit without separating the discovered bug from test cleanup.

Keep code, documentation and comments in English. Keep implementation modules
focused (aim for at most 200 code lines) and test files under 600 code lines;
comments do not count toward those limits. Preserve public package entrypoints.

Use isolated test-owned databases and release all resources after success,
failure or cancellation. Never mutate shared development or production data.
