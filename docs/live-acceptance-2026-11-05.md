# Live Telegram acceptance: issue #53 and account safety

Date: 2026-11-05. This follows the [source and behavior challenge](issue-53-challenge-2026-11-05.md).
The real Telegram app on a physical Google Pixel 10 Pro (Android 17), Chrome 155
on that phone, a shared desktop browser, and two disposable Telegram bots were
used. The local built plugin ran against Better Auth 1.7.17 behind a temporary
HTTPS tunnel. The database scenarios used test-owned in-memory SQLite.

## Result

The real OIDC callback, legacy Widget and Mini App completed successfully. The
previous fixes rejected revoked-session account changes and rejected OIDC session
creation after application hooks revoked its account. The follow-up also found
and corrected a documentation gap about returning users without a database, and a
cookie-selection bug in the diagnostic harness. No additional production runtime
change was needed during this live follow-up.

## Evidence

Local evidence is kept outside version control in
`artifacts/live-issue53-2026-11-05/`. These are private local paths from this run;
a fresh clone contains the report and harness, not the evidence files:

- Structured event log (`artifacts/live-issue53-2026-11-05/events.jsonl`): 289 events, including the diagnostic correction annotation.
- Manifest and SHA-256 hashes (`artifacts/live-issue53-2026-11-05/manifest.json`).
- Successful mobile OIDC recording (`artifacts/live-issue53-2026-11-05/oidc-device-success.mp4`).
- Mini App and generated unlink recording (`artifacts/live-issue53-2026-11-05/miniapp-device.mp4`).
- Revoked-session recording (`artifacts/live-issue53-2026-11-05/revoked-session-device.mp4`).
- Mobile JWT evidence (`artifacts/live-issue53-2026-11-05/trusted-mobile-jwt.png`), fresh session claims (`artifacts/live-issue53-2026-11-05/fresh-session-claims.png`), Mini App session (`artifacts/live-issue53-2026-11-05/miniapp-session.png`), rejected unlink (`artifacts/live-issue53-2026-11-05/revoked-unlink.png`), and bot deletion readback (`artifacts/live-issue53-2026-11-05/bots-deleted.png`).

The directory also retains the initial UI attempts and touch telemetry. The first
long recording is split into two files because Android screenrecord limits each
chunk to 180 seconds. Short recordings can end at the last changing frame rather
than the exact recording stop time; the device tool disclosed that limit.

The JSONL contains request paths/statuses, callback parameter **names**, real token
endpoint/JWKS response metadata, verified claim types, application decisions,
hooks and pseudonymized session/JWT fields. It omits raw credentials, codes, state,
nonce, cookies, JWTs, initData and Telegram profile details. Recordings may show
normal device UI and notification banners; keep them private. All evidence files
are mode 0600, and `/artifacts/` is ignored by Git.

## Executed scenarios

Times below are UTC and refer to `events.jsonl`.

| Scenario | Observed result and evidence |
| --- | --- |
| Real OIDC with creation-time server-owned user fields | Mobile callback at 08:37:24 returned 302 after a real `/token` exchange and JWKS verification. Both session API and JWT contained `user_id:42`, fixture name/nick and role `member`. |
| Reported mapper configuration with `input:false` | At 08:35:20 the real mapper-mode callback succeeded, but protected user fields were absent; the input-allowed nickname was present. This matches Better Auth's documented filter. |
| Generic user-field edit | `/trusted/api/auth/update-user` returned 400 `FIELD_NOT_ALLOWED`; subsequent read retained the original member values. |
| Logout | After mobile sign-out, session evidence returned `authenticated:false`, with no user/session/JWT evidence. |
| Application denies a returning identity | At 08:39:48 the real profile verified, validation returned `not_a_member`, the callback showed that error, and a subsequent read returned no session. No `session_created` event followed that rejected attempt. |
| Persistent returning-user profile refresh | The same SQLite user fingerprint was retained between 08:40:37 and 08:41:19. Its nickname changed from `profile-v1` to `profile-v2`; protected user role remained its stored value. |
| Account revoked during returning validation, default upstream token update | At 08:42:18 validation deleted the account. Better Auth rejected earlier with `unable_to_update_account`; no session was issued. This is not evidence of the plugin's final guard by itself. |
| New account revoked in its creation hook | At 08:45:14 a new account was created and then deleted by the hook. The callback returned `ACCOUNT_NOT_LINKED`, and session readback was null. |
| Fresh claims on repeated stateless sign-in | At 08:59:12 and 08:59:51 the same in-memory user fingerprint was retained. User role stayed `member`; the new session and JWT.session changed to role `editor` and nick `member-v2`. |
| Generic session-field edit | At 08:59:33 `/trusted/api/auth/update-session` returned 400 `FIELD_NOT_ALLOWED`. |
| Real Mini App launch | At 08:56:50 the bot's menu launched the page inside Telegram, supplied real signed initData, and `/telegram/miniapp/signin` returned 200 with a session. |
| Generated unlink route | At 08:57:32 `authClient.telegram.unlink()` sent POST without a dummy body and returned 200. The same user's Telegram identity was cleared from the session. A later signed Mini App sign-in created a new auth user after the previous account had been unlinked, as documented. |
| Real legacy Login Widget | At 09:02:03 the Widget completed Telegram's consent popup and `/telegram/signin` returned 200. It reached the same user fingerprint as the preceding Mini App login. The widget initialized with global `fetchOptions.throw:true`. |
| Revoked cached session cannot link | At 09:02:15 the test action deleted only the current stored session and retained the browser cache. At 09:03:05 `/telegram/link` returned 401. |
| Revoked cached session cannot unlink, independent attempt | A fresh Widget sign-in succeeded at 09:03:59. The session was revoked at 09:04:12; unlink was the first protected mutation after that revocation and returned 401 at 09:04:13, before its original expiry. |
| Returning account revoked with upstream token updates disabled | With `account.updateAccountOnSignIn:false`, the 09:06:03 validation hook revoked the account. The plugin's final ownership guard returned `ACCOUNT_NOT_LINKED`; readback showed no session. |
| Expired stateless session | The session issued at 08:59:51 expired at 09:04:51. Reading the trusted page at 09:06 returned `authenticated:false` without a new sign-in. |

The legacy revoke action is test-only, Origin checked and authenticated against
current server storage. It accepts no arbitrary user/session ID and revokes only
the caller's own session. The valid unlink and the revoked-session unlink were
separate attempts, so a preceding 401 could not make the latter vacuous by already
clearing its cookie.

## Corrections discovered by live testing

### Creation-time user fields do not refresh automatically

Better Auth's no-database setup still has a memory adapter per auth instance.
Users and accounts survive while that instance is running. A returning OAuth
login reruns validation but skips `user.create.before`, so fresh request-local
lookup data does not replace the stored user fields. The earlier statement that
a new sign-in alone refreshes those values was incomplete.

The [server-owned fields guide](server-owned-fields.md) now distinguishes:

- creation-time values in `user.additionalFields`;
- fresh per-sign-in values in `session.additionalFields`, supplied by
  `databaseHooks.session.create.before`.

The latter values live under `session`, including in the decoded JWT. The guide
states that path explicitly and includes a complete compiled example. It does
not bypass `input:false`, duplicate cookie-writing code, or require `customSession`.
Already issued claims remain snapshots; immediate permission revocation still
requires checking current application authorization.

Four additional integration tests protect same-instance repeated login, JWT
readback on another instance, forbidden generic edits, and rejected admission.

### The diagnostic reader must select the mode's exact cookie

One diagnostic `session_read` at **09:02:03.778** correctly read the legacy session
through Better Auth, but its separately decoded `jwt` subsection selected the
trusted mode's earlier cookie. The original JSONL entry remains for traceability;
a final `diagnostic_correction` event marks that subsection invalid. Do not use it
as JWT evidence.

The reader now obtains `authCookies.sessionData.name` from the selected auth
instance and selects that exact cookie. The repeated real Widget sign-in at
**09:03:59.290**, while the other mode's cookie was still valid, shows matching
legacy user/session fingerprints in both API and JWT evidence. Earlier isolated
Mini App and trusted-mode reads were not affected by this ordering mistake.

Some initial native-popup taps dismissed the prompt without completing approval.
A screenshot-guided tap on the visible Log In area completed it and returned the
callback. This was a device-automation interaction issue, not a reproduced plugin
failure. Superseded attempts also produced a `state_mismatch`; successful and
intentional refusal scenarios above are identified separately by time.

## Verification and cleanup

After the follow-up changes, the default suite passed **361 tests** with unchanged
coverage gates (98.69% lines, 96% branches, 100% functions). Source types, both
built consumer type modes, lint and whitespace checks passed. The four new
session-claim tests also passed on Bun 1.4.4 and Node 24.22.2. The live harness was
bundled and executed; its mode configuration and helper modules received focused
type checks during authoring.

The prior 103-pass real-adapter lane and installed ESM/CommonJS package checks
remain evidence for the unchanged production runtime. They were not rerun merely
for this documentation/test-harness follow-up.

Both newly created bots were deleted and BotFather read back `You have currently
no bots`. A supplementary direct Bot API deletion probe encountered a connection
reset before an HTTP response, so it supplies no additional deletion evidence.
The test server and tunnel were stopped, owned SQLite handles were released,
three newly opened mobile Chrome tabs were closed (the original five remain), the
new Mini App tab and shared preview tab were closed, and private local credentials
and raw device diagnostic output were removed. The phone was not shut down.

## Scope limits

The provider, consent UI, signatures, callback and Better Auth processing were
real. The application membership lookup intentionally returned fixture member
records; the reporter's external SQL database was not accessed. This run does not
establish iOS behavior, Telegram Web iframe cookie behavior, load/concurrency
across independent servers, or compatibility with every application hook. Those
boundaries retain the limits documented in [Security](security.md).

No commit, push, npm publication or GitHub reply was made.


## Subsequent 3.2.2 release review

The final release review additionally found that an application account-creation
hook could change a fresh OIDC binding before the earlier guard remembered its
owner. The release now pins the original owner before application hooks and
rejects a changed owner before identity synchronization. Changes to account key
or provider also prevent that sign-in from creating a session.

Six focused cases (owner, account key and provider, with and without legacy
identity fields) reproduced the gap before the fix and passed afterward. The
final default suite has 367 tests. This delta was checked through the real Better
Auth integration boundary and the release gates; the device recordings above
remain evidence for the preceding live-tested tree, as recorded by their manifest.
The OIDC protocol and browser interactions were not changed by this delta.
