// docs/server-owned-fields.md: compiled against the public package.
import { defineRequestState } from "@better-auth/core/context";
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

declare function findMemberByTelegramId(
  telegramId: string
): Promise<Member | null>;

interface Member {
  role: string;
  user_id: number;
  user_name: string;
  user_nick: string;
}

// A separate value for each request, including concurrent sign-ins.
const verifiedMember = defineRequestState<Member | null>(() => null);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  session: {
    expiresIn: 300,
    cookieCache: {
      enabled: true,
      strategy: "jwt",
      maxAge: 300,
      refreshCache: false,
    },
  },
  account: { storeStateStrategy: "cookie", storeAccountCookie: true },
  user: {
    additionalFields: {
      user_id: {
        type: "number",
        required: false,
        input: false,
        returned: true,
      },
      user_name: {
        type: "string",
        required: false,
        input: false,
        returned: true,
      },
      user_nick: {
        type: "string",
        required: false,
        input: false,
        returned: true,
      },
      role: { type: "string", required: false, input: false, returned: true },
    },
    async validateUserInfo({ source }) {
      const telegramId = source.oauth?.profile?.id;
      if (
        source.oauth?.providerId !== "telegram-oidc" ||
        typeof telegramId !== "string"
      ) {
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
