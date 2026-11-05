# Live Telegram acceptance harness

Runs the locally built package against the real Telegram OIDC issuer, legacy Login
Widget and Mini App. It has no
production database: the database mode owns an in-memory SQLite database and the
two stateless modes have no Better Auth database. Stop the process to discard it.

From the repository root, build the current package, then supply private files:

```sh
npm run build
BAT_LIVE_BASE_URL=https://your-public-tunnel.example \
BAT_LIVE_CREDENTIALS_FILE=/private/credentials.json \
BAT_LIVE_LOG_FILE=/private/events.jsonl \
BAT_LIVE_CONTROL_FILE=/private/control.json \
bun run test/live-acceptance/server.ts
```

The credentials JSON requires `oidcClientId` and `oidcClientSecret` from a disposable
OIDC bot. Optional `legacyBotToken` and `legacyBotUsername` enable `/legacy` using
a separate bot whose legacy Widget remains enabled. Never commit credentials,
control files, databases or raw authentication data. Use file permissions 0600.

Register all three callback URLs in BotFather:

- `https://your-public-tunnel.example/trusted/api/auth/callback/telegram-oidc`
- `https://your-public-tunnel.example/mapper/api/auth/callback/telegram-oidc`
- `https://your-public-tunnel.example/database/api/auth/callback/telegram-oidc`

Register the public origin as a trusted origin in BotFather. Start a tunnel to
127.0.0.1:3417. Open `/trusted`, `/mapper` or `/database` on the device. The optional
`BAT_LIVE_AUTH_SECRET` keeps stateless sessions readable across harness restarts;
otherwise a new random secret is generated at each start.

The browser uses a bundle of the current local client plugin and Better Auth
client. Trusted mode keeps a creation-only user snapshot and also puts freshly
looked-up fields under `session` at each accepted sign-in. The readonly user and
session API update attempts can be exercised separately. It can start sign-in, show sanitized session/JWT evidence, attempt a
forbidden role update and sign out. The fixture member values are deliberate:
`user_id: 42`, role `member` and fixed nonpersonal labels. The mapper tries to write
`user_id: 999` and role `admin`; those `input:false` values must remain absent in
mapper mode and must not override the trusted creation hook in trusted mode.

The optional control JSON is read on every sign-in attempt:

```json
{"deny": false, "profileVersion": 1, "revokeOnValidation": false, "revokeOnCreate": false}
```

`deny:true` refuses sign-in before a session. `profileVersion:2` changes trusted
stateless fixture values to role `editor` and maps `nickname:profile-v2`; database
mode updates the input-allowed nickname on returning sign-in. The two revoke
switches remove the owned OIDC account through Better Auth's internal adapter
during validation of a returning sign-in or after account creation. They should
prevent the attempted login from issuing a session. Disable each switch before
the next unrelated case. Changes to this local file have no public HTTP endpoint.

The JSONL log records method/path/status, callback query parameter names, provider
HTTP status/timing and token response shape (never its contents), allowlisted
redirect paths and error codes (no full URL or error description), verified
claim types, hashed identities, application decisions, hook execution and sanitized
session fields. It omits auth codes, state, nonce, JWT/cookie/session tokens, raw
initData, credentials, Telegram names, email and phone. Browser display is similarly
sanitized. The log is mode 0600. Keep screen recordings away from BotFather's secret
screens; the browser's address bar may temporarily contain an OAuth code.

A signed local OIDC fixture can smoke-test the harness without a Telegram account;
that does not establish live Telegram acceptance. The live evidence must come from
the lead agent's actual device flow and matching structured callback/session log.

## Legacy Widget and Mini App

Register the tunnel host with `/setdomain` for the legacy bot and configure its
Mini App/menu launch URL as `https://your-public-tunnel.example/legacy`. Open it in
Telegram to supply real signed initData. The SDK and the local plugin perform
auto-sign-in when initData is available; the manual button can repeat it.

The legacy page sets global `fetchOptions.throw: true`, initializes the real Login
Widget, uses `authClient.telegram.unlink()` without a dummy body, and can relink
using the last signed Widget payload held only in page memory. It permits removal
of the test user's last account so the generated unlink route can be exercised.

The page's revoke button calls a test-only `POST /legacy/revoke`. It requires the
configured Origin and a currently live session checked without cookie cache. It
revokes only that request's own server-side session, retains its browser cache,
and accepts no user identifier or token in its body. Link/unlink must then refuse
the cached session even if session evidence is still readable until cache expiry.
There is no route to revoke another user's session.
