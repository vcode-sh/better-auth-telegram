import { defineRequestState } from "@better-auth/core/context";
import { fingerprint, readControl } from "./log";

type Log = (event: string, details?: Record<string, unknown>) => void;
export const serverOwnedFields = {
  user_id: { type: "number", required: false, input: false, returned: true },
  user_name: { type: "string", required: false, input: false, returned: true },
  user_nick: { type: "string", required: false, input: false, returned: true },
  role: { type: "string", required: false, input: false, returned: true },
} as const;

export function createMemberPolicy(mode: string, log: Log) {
  const state = defineRequestState<Record<string, unknown> | null>(() => null);
  return {
    async validateUserInfo({ user, source }: any, ctx: any) {
      const profile = source.oauth?.profile;
      const control = readControl(process.env.BAT_LIVE_CONTROL_FILE);
      const valid =
        source.oauth?.providerId === "telegram-oidc" &&
        typeof profile?.id === "string";
      log("application_validation", {
        mode,
        action: source.action,
        valid,
        denied: control.deny,
        telegramFingerprint: fingerprint(profile?.id),
      });
      if (!valid || control.deny) return { error: "not_a_member" };
      if (source.action === "sign-in" && control.revokeOnValidation) {
        const accounts = await ctx.context.internalAdapter.findAccounts(
          user.id
        );
        for (const account of accounts.filter(
          (row: any) => row.providerId === "telegram-oidc"
        )) {
          await ctx.context.internalAdapter.deleteAccount(account.id);
        }
        log("account_revoked_in_validation", { mode });
      }
      await state.set({
        user_id: 42,
        user_name: "Live Test Member",
        user_nick: `member-v${control.profileVersion}`,
        role: control.profileVersion === 2 ? "editor" : "member",
      });
    },
    async fieldsForCreation(target: "user" | "session") {
      const member = await state.get();
      if (!member) return false;
      log("trusted_fields_supplied", {
        mode,
        target,
        keys: Object.keys(member),
      });
      return {
        data: {
          user_id: member.user_id,
          user_name: member.user_name,
          user_nick: member.user_nick,
          role: member.role,
        },
      };
    },
  };
}
