# Server-owned fields in an OIDC session

`input: false` prevents both API requests and provider mappers from setting a
field. `returned: true` includes its **stored** value in the user response and
session cookie; it does not populate it. This is Better Auth's documented
[provider mapping contract](https://better-auth.com/docs/concepts/oauth#server-owned-fields-and-authorization-claims),
including stateless authentication. Setting `input: true` for a role or your
application's user ID would also let a user submit that field to `/update-user`.

You do not need `customSession` to include stored fields in the JWT. You need a
trusted write before Better Auth builds the session.

## Stateless OIDC with an application user lookup

This example covers the setup in [issue #53](https://github.com/vcode-sh/better-auth-telegram/issues/53):
Better Auth has no database, while your application looks up members in its own
database. The validation callback receives the verified Telegram profile. It
rejects unknown users and keeps the selected member in request-local state. A
[database hook](https://better-auth.com/docs/concepts/database#database-hooks)
then supplies the server-owned fields when Better Auth creates a user. This also
works without a configured database, but it is a **creation hook**, not a hook that
updates user fields on every sign-in. The same running Better Auth instance keeps
an in-memory user/account store, and a returning user skips creation. See the
per-sign-in session fields below when values must be refreshed at each login.

```ts
import { defineRequestState } from "@better-auth/core/context";
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";
import { findMemberByTelegramId } from "./members";

interface Member {
  user_id: number;
  user_name: string;
  user_nick: string;
  role: string;
}

// A separate value for each request, including concurrent sign-ins.
const verifiedMember = defineRequestState<Member | null>(() => null);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  session: {
    expiresIn: 300,
    cookieCache: { enabled: true, strategy: "jwt", maxAge: 300, refreshCache: false },
  },
  account: { storeStateStrategy: "cookie", storeAccountCookie: true },
  user: {
    additionalFields: {
      user_id: { type: "number", required: false, input: false, returned: true },
      user_name: { type: "string", required: false, input: false, returned: true },
      user_nick: { type: "string", required: false, input: false, returned: true },
      role: { type: "string", required: false, input: false, returned: true },
    },
    async validateUserInfo({ source }) {
      const telegramId = source.oauth?.profile?.id;
      if (source.oauth?.providerId !== "telegram-oidc" || typeof telegramId !== "string") {
        return { error: "telegram_required" };
      }
      // Implement this with your application's parameterized query.
      const member: Member | null = await findMemberByTelegramId(telegramId);
      if (!member) {
        return { error: "not_a_member" };
      }
      await verifiedMember.set(member);
    },
  },
  databaseHooks: {
    user: {
      create: {
        async before() {
          const member = await verifiedMember.get();
          if (!member) {
            return false;
          }
          return {
            data: {
              user_id: member.user_id,
              user_name: member.user_name,
              user_nick: member.user_nick,
              role: member.role,
            },
          };
        },
      },
    },
  },
  plugins: [
    telegram({
      loginWidget: false,
      oidc: {
        enabled: true,
        clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
        clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
      },
    }),
  ],
});
```

`findMemberByTelegramId` must return a member from your application database or
`null`. Use the verified `id` claim, not the bot-specific `sub`, a username, or a
field supplied in the HTTP request. Do not keep the current member in a shared
variable. Only copy the intended fields from the database result.

The fields are `required: false` because Better Auth parses provider input before
running the validation callback and database hook. The callback and hook enforce
the application requirement instead: an unknown member cannot obtain a session.
A required server-owned field without a default fails earlier with `MISSING_FIELD`.

This sample allows only Telegram OIDC to create users. If your configuration
supports other providers, define their validation and trusted field population
explicitly. `account` belongs beside `session`; JWT cookie encoding is selected by
`session.cookieCache.strategy`, not `session.strategy`.

## Returning users and changes to permissions

The creation hook runs only for new users, including when a configuration without
a database reuses its in-memory user in the same process. Validation still runs on
returning sign-ins and can deny admission, but setting request-local member data
does not update the existing user. With persistent storage, backfill existing
users and update server-owned values through your application's trusted database
layer. `oidc.updateUserInfoOnSignIn` refreshes input-allowed
profile fields; it does not bypass `input: false`.

A JWT contains the values at issuance. Better Auth enables rolling cookie refresh
by default without a database; this sample explicitly sets `refreshCache: false`
so activity does not keep extending those claims. Reading or refreshing its cookie does not
repeat the application lookup. Choose its lifetime accordingly. A new sign-in repeats validation, but only
updates values if your trusted write path also handles returning users. Check
current permissions in your application for operations that need immediate
revocation. A long-lived cookie is not a live
membership check.

The regression suite exercises this recipe with real Better Auth, a signed test
OIDC issuer, a decoded JWT, a second auth instance reading that cookie, rejected
`/update-user` attempts, and a rejected subsequent sign-in. It does not require
`customSession`.


## Fresh claims on every sign-in

For values that must follow the application lookup at **each accepted sign-in**,
use `session.additionalFields` and `databaseHooks.session.create.before`. Every
new session runs that hook, including a returning user in the same process.
These values live under `session.user_id` and `session.role` in the JWT and
`getSession` result, rather than under `user`. Update consumers to read that path.

This is a complete alternative to the creation-only user-field example above:

```ts
import { defineRequestState } from "@better-auth/core/context";
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";
import { findMemberByTelegramId } from "./members";

interface Member {
  user_id: number;
  role: string;
}

const verifiedMember = defineRequestState<Member | null>(() => null);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  account: { storeStateStrategy: "cookie", storeAccountCookie: true },
  user: {
    async validateUserInfo({ source }) {
      const telegramId = source.oauth?.profile?.id;
      if (source.oauth?.providerId !== "telegram-oidc" || typeof telegramId !== "string") {
        return { error: "telegram_required" };
      }
      const member: Member | null = await findMemberByTelegramId(telegramId);
      if (!member) {
        return { error: "not_a_member" };
      }
      await verifiedMember.set(member);
    },
  },
  session: {
    expiresIn: 300,
    cookieCache: { enabled: true, strategy: "jwt", maxAge: 300, refreshCache: false },
    additionalFields: {
      user_id: { type: "number", required: false, input: false, returned: true },
      role: { type: "string", required: false, input: false, returned: true },
    },
  },
  databaseHooks: {
    session: {
      create: {
        async before() {
          const member = await verifiedMember.get();
          if (!member) {
            return false;
          }
          return { data: { user_id: member.user_id, role: member.role } };
        },
      },
    },
  },
  plugins: [
    telegram({
      loginWidget: false,
      oidc: {
        enabled: true,
        clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
        clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
      },
    }),
  ],
});
```

The example still allows only Telegram OIDC. Adapt the admission policy and claim
population explicitly if you enable another sign-in method. A refused application
lookup creates no session. Generic `/update-session` requests cannot change the
server-owned fields.

This refreshes claims at sign-in, not while an existing cookie is being read. A
role changed after issuance remains a snapshot until a new sign-in or expiration;
check current application permissions when immediate revocation is required.
The same-instance returning-user regression checks the new role in both the
session API and decoded JWT, with no `customSession`.
