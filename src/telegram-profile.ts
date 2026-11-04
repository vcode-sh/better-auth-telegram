import type { AuthContext } from "@better-auth/core";
import { parseAdditionalUserInputFromProviderProfile } from "better-auth/db";
import { markChanged } from "./telegram-identity-state";

/** Stored and mapped values compared as the database would store them. */
function sameValue(stored: unknown, mapped: unknown) {
  if (stored instanceof Date || mapped instanceof Date) {
    return (
      stored !== null &&
      stored !== undefined &&
      mapped !== null &&
      mapped !== undefined &&
      new Date(stored as Date).getTime() === new Date(mapped as Date).getTime()
    );
  }
  if (typeof stored === "object" && typeof mapped === "object") {
    return JSON.stringify(stored) === JSON.stringify(mapped);
  }
  return stored === mapped;
}

/**
 * `oidc.updateUserInfoOnSignIn`: writes the profile from this sign-in
 * (name, image, mapped fields) onto the user, like Better Auth's
 * `overrideUserInfoOnSignIn` but never the email. Runs once Better Auth has
 * allowed the sign-in; a refused update leaves the stored profile, as
 * Better Auth's own profile updates do.
 */
export async function updateUserInfo(
  ctx: AuthContext,
  userId: string,
  userInfo: Record<string, unknown>
) {
  const {
    id: _id,
    email: _email,
    emailVerified: _emailVerified,
    name,
    image,
    ...profile
  } = userInfo;
  const user = (await ctx.internalAdapter.findUserById(userId)) as Record<
    string,
    unknown
  > | null;
  if (!user) {
    return;
  }
  try {
    // Field validators can throw here too.
    const changes = Object.fromEntries(
      Object.entries({
        name,
        image,
        ...parseAdditionalUserInputFromProviderProfile(
          ctx.options,
          profile,
          "update"
        ),
      }).filter(
        ([key, value]) => value !== undefined && !sameValue(user[key], value)
      )
    );
    if (Object.keys(changes).length === 0) {
      return;
    }
    if (!(await ctx.internalAdapter.updateUser(userId, changes))) {
      throw new Error("a database hook refused the update");
    }
    await markChanged(userId);
  } catch (error) {
    ctx.logger.warn(
      "[better-auth-telegram] OIDC: could not update the user's profile on sign-in.",
      error
    );
  }
}
