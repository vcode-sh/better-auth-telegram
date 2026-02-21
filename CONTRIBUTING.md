# Contributing

You want to help build a Telegram auth plugin. Telegram, the platform where bots talk to bots about talking to bots. Sounds about right. Come on in.

## Development Setup

```bash
git clone https://github.com/vcode-sh/better-auth-telegram.git
cd better-auth-telegram
npm install
```

### Prerequisites

- Node.js >= 22 (see `.nvmrc` -- yes, I pinned it, I'm not an animal)
- npm >= 10

## Commands

These are the incantations. Learn them. Love them. Run them before pushing.

```bash
npm run dev          # Watch mode build -- for the impatient
npm run build        # Production build (ESM + CJS + DTS) -- the real thing
npm run type-check   # TypeScript strict check -- the compiler judges you so I don't have to
npm test             # Run all tests -- you'd be surprised how many people skip this
npm run test:watch   # Watch mode -- for when you're in the zone
npm run test:ui      # Vitest UI -- pretty graphs that prove you did something
npm run test:coverage # Coverage report -- the number must go up
npm run lint         # Biome lint check -- it has opinions and they are correct
npm run lint:fix     # Auto-fix -- let the machine do the boring part
```

## Project Structure

```
src/
  index.ts       Server plugin entry (endpoints, schema, hooks)
  client.ts      Client plugin (widget init, API methods, Mini App helpers)
  verify.ts      HMAC-SHA-256 verification via Web Crypto API
  types.ts       TypeScript interfaces
  constants.ts   Error codes, defaults, PLUGIN_ID
  *.test.ts      Co-located tests
```

## The Rules

Not guidelines. Not suggestions. Rules.

1. **Tests live next to their code** as `*.test.ts` -- no hunting through a distant `__tests__` folder like it's 2017
2. **Run `npm run lint:fix`** before committing -- Biome catches things your eyes won't
3. **All tests must pass** with `npm test` -- a failing test suite is not a "known issue," it's a blocker
4. **Type safety everywhere** -- no `any` at public API boundaries, this isn't JavaScript
5. **Security first, features second** -- validate inputs, verify signatures, no shortcuts
6. **Async verification only** -- all crypto goes through `crypto.subtle`, no synchronous `node:crypto`
7. **Use `APIError` from `better-auth/api`** -- raw `ctx.json({ error })` died in v0.4.0, let it rest
8. **Update CHANGELOG.md** for user-facing changes -- the changelog is a love letter to your future maintainers

## Testing

I maintain 90%+ coverage. Not because I worship the metric, but because untested code is just a theory.

- **Verification**: crypto tests in `verify.test.ts` -- HMAC paths, replay attacks, edge cases
- **Server plugin**: endpoint tests in `index.test.ts` -- signin, link, unlink, config, Mini App flows
- **Client plugin**: mock `$fetch`, test widget init and API methods in `client.test.ts`
- **Security**: adversarial inputs, timestamp manipulation, malformed data

## Pull Request Process

1. Fork the repo and branch off `main` (not `develop`, not `feature-branch-from-six-months-ago`)
2. Write tests for your new code (yes, before the PR, not "I'll add them later")
3. Make sure absolutely everything passes:
   ```bash
   npm run type-check && npm test && npm run lint
   ```
4. Update documentation if applicable (it is applicable more often than you think)
5. Update `CHANGELOG.md` under an `[Unreleased]` section
6. Open a PR with a clear description -- "misc fixes" tells me nothing

## Reporting Issues

- **Bugs**: use the [bug report template](https://github.com/vcode-sh/better-auth-telegram/issues/new?template=bug_report.yml)
- **Features**: use the [feature request template](https://github.com/vcode-sh/better-auth-telegram/issues/new?template=feature_request.yml)
- **Security**: see [SECURITY.md](SECURITY.md) -- do NOT open a public issue for vulnerabilities unless you enjoy chaos

## Code of Conduct

There is one. It's in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). The short version: don't be awful. The long version: read the file.
