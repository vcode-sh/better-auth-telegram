import type { GenericEndpointContext } from "@better-auth/core";
import { runWithTransaction } from "@better-auth/core/context";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import { createPlaceholderEmail } from "@better-auth/core/utils/email";
import { APIError, isAPIError } from "better-auth/api";
import { ERROR_CODES, PLUGIN_ID } from "./constants";
import {
  accountData,
  assertValidUserInfo,
  findTelegramAccount,
  findUserByTelegramId,
  hasLinkedTelegramIdentity,
  type TelegramAccount,
  type TelegramIdentity,
  type TelegramProvisioningOptions,
  type TelegramUser,
  type UserData,
  withTelegramOperation,
} from "./telegram-account-state";
import {
  createTelegramUser,
  refreshIdentity,
  signInWithAccount,
} from "./telegram-account-user";

// biome-ignore lint/performance/noBarrelFile: Keep existing internal imports stable across the extraction.
export {
  linkTelegramAccount,
  unlinkTelegramAccount,
} from "./telegram-account-link";
export type {
  TelegramIdentity,
  TelegramProvisioningMethod,
} from "./telegram-account-state";
export { withTelegramOperation } from "./telegram-account-state";
export { refreshSessionCookie, startSession } from "./telegram-session";

/**
 * Finds the user for a verified Telegram identity, linking or creating the
 * Telegram account when needed:
 *
 * 1. an account `telegram/<id>` → its user;
 * 2. a user with this `telegramId` (Mini App, Login Widget or OIDC) → link;
 * 3. otherwise create the user and account, when `allowCreate` is set.
 *
 * Writes go through Better Auth's internal adapter, so `databaseHooks` apply,
 * and `user.validateUserInfo` sees every sign-in, link and sign-up.
 */
export async function findOrCreateTelegramUser(
  ctx: GenericEndpointContext,
  options: TelegramProvisioningOptions
): Promise<TelegramUser> {
  return await withTelegramOperation(
    ctx,
    `telegram:${options.identity.telegramId}`,
    () => findOrCreate(ctx, options)
  );
}

async function findOrCreate(
  ctx: GenericEndpointContext,
  options: TelegramProvisioningOptions
): Promise<TelegramUser> {
  const { identity, method } = options;
  const { internalAdapter } = ctx.context;

  const account = await findTelegramAccount(ctx, identity.telegramId);
  if (account) {
    return await signInWithAccount(ctx, account, identity, method);
  }

  const existingUser = await findUserByTelegramId(ctx, identity.telegramId);
  if (
    existingUser &&
    (await hasLinkedTelegramIdentity(ctx, existingUser.id, identity.telegramId))
  ) {
    // Another server's first sign-in may have committed this user (and, in
    // the same transaction, the account) since the lookup above.
    const committed = await findTelegramAccount(ctx, identity.telegramId);
    if (committed) {
      return await signInWithAccount(ctx, committed, identity, method);
    }
    // Same rule as Better Auth's OAuth sign-in linking to an existing user.
    const accountLinking = ctx.context.options.account?.accountLinking;
    if (
      accountLinking?.enabled === false ||
      accountLinking?.disableImplicitLinking === true
    ) {
      throw APIError.from("UNAUTHORIZED", ERROR_CODES.ACCOUNT_NOT_LINKED);
    }
    await assertValidUserInfo(ctx, existingUser, "link-account", method);
    return await withTelegramOperation(ctx, `user:${existingUser.id}`, () =>
      runWithTransaction(ctx.context.adapter, async () => {
        const linked = await internalAdapter.linkAccount(
          accountData(existingUser.id, identity)
        );
        if (!linked) {
          throw APIError.from(
            "FORBIDDEN",
            ERROR_CODES.ACCOUNT_CREATION_REJECTED
          );
        }
        return await refreshIdentity(
          ctx,
          existingUser,
          linked as TelegramAccount,
          identity
        );
      })
    );
  }

  if (!options.allowCreate) {
    throw APIError.from("NOT_FOUND", options.notFound);
  }

  let email = signUpEmail(options.userData, identity);
  if (await internalAdapter.findUserByEmail(email)) {
    // Either another server just created this Telegram user (sign in as
    // them), the placeholder stayed with a user who unlinked this Telegram
    // account (sign up with another reserved placeholder), or a mapper
    // returned someone else's email: refuse it like Better Auth's
    // /sign-up/email does.
    const created = await findTelegramAccount(ctx, identity.telegramId);
    if (created) {
      return await signInWithAccount(ctx, created, identity, method);
    }
    if ((options.userData.email ?? null) !== null) {
      throw APIError.from(
        "UNPROCESSABLE_ENTITY",
        BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL
      );
    }
    email = createPlaceholderEmail({
      identifier: `${identity.telegramId}.${randomSuffix()}`,
      namespace: PLUGIN_ID,
    });
  }

  try {
    return await createTelegramUser(ctx, options, email);
  } catch (error) {
    // Another server created this Telegram user a moment earlier, and the
    // database refused our copy (unique email): sign in as that user.
    const created = isAPIError(error)
      ? null
      : await findTelegramAccount(ctx, identity.telegramId);
    if (!created) {
      throw error;
    }
    return await signInWithAccount(ctx, created, identity, method);
  }
}

/** Eight lowercase base-36 characters. */
function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

/** A mapper's email, or the placeholder (Better Auth's user.email is required). */
function signUpEmail(userData: UserData, identity: TelegramIdentity): string {
  return (
    userData.email ??
    createPlaceholderEmail({
      identifier: identity.telegramId,
      namespace: PLUGIN_ID,
    })
  );
}
