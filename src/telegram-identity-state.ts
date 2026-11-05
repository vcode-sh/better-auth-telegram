import { defineRequestState, hasRequestState } from "@better-auth/core/context";
import type { TelegramOIDCClaims } from "./types";

interface VerifiedSignIn {
  /** Users this request changed after Better Auth read them. */
  changedUserIds: Set<string>;
  claims: TelegramOIDCClaims;
  /** Account owner before Better Auth awaits application sign-in validation. */
  expectedUserId?: string | undefined;
  /** The user info `getUserInfo` gave Better Auth (mapper output included). */
  userInfo: Record<string, unknown>;
}

/**
 * The Telegram ID token verified during the current request. Set by the
 * OIDC provider's `getUserInfo`, read by the hooks below.
 */
const verifiedSignIn = defineRequestState<VerifiedSignIn | null>(() => null);

export async function rememberVerifiedClaims(
  claims: TelegramOIDCClaims,
  userInfo: Record<string, unknown>
) {
  if (await hasRequestState()) {
    await verifiedSignIn.set({ claims, userInfo, changedUserIds: new Set() });
  }
}

export async function currentSignIn() {
  return (await hasRequestState()) ? await verifiedSignIn.get() : null;
}

export async function currentClaims() {
  return (await currentSignIn())?.claims ?? null;
}

export async function markChanged(userId: string) {
  (await currentSignIn())?.changedUserIds.add(userId);
}
