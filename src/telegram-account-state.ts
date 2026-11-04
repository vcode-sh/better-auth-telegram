import type { GenericEndpointContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import type { Account, User } from "better-auth";
import { APIError } from "better-auth/api";
import { ERROR_CODES, PLUGIN_ID, TELEGRAM_OIDC_PROVIDER_ID } from "./constants";

/** A Telegram user proven by a verified Login Widget or Mini App payload. */
export interface TelegramIdentity {
  /** Telegram user id as a string. */
  telegramId: string;
  username?: string | undefined;
}

/** Provisioning method reported to `user.validateUserInfo`. */
export type TelegramProvisioningMethod =
  | "telegram-login-widget"
  | "telegram-mini-app";

export interface UserData {
  email?: string | null | undefined;
  emailVerified?: boolean | undefined;
  image?: string | null | undefined;
  name?: string | undefined;
  [key: string]: unknown;
}

export type TelegramUser = User & {
  telegramId?: string | null;
  telegramPhoneNumber?: string | null;
  telegramUsername?: string | null;
};

export type TelegramAccount = Account & {
  telegramId?: string | null;
  telegramUsername?: string | null;
};

export interface TelegramProvisioningOptions {
  allowCreate: boolean;
  identity: TelegramIdentity;
  method: TelegramProvisioningMethod;
  notFound: (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
  userData: UserData;
}

export function accountData(userId: string, identity: TelegramIdentity) {
  return {
    userId,
    providerId: PLUGIN_ID,
    accountId: identity.telegramId,
    telegramId: identity.telegramId,
    telegramUsername: identity.username,
  };
}

export function findUserByTelegramId(
  ctx: GenericEndpointContext,
  telegramId: string
) {
  return ctx.context.adapter.findOne<TelegramUser>({
    model: "user",
    where: [{ field: "telegramId", value: telegramId }],
  });
}

export async function hasLinkedTelegramIdentity(
  ctx: GenericEndpointContext,
  userId: string,
  telegramId: string
) {
  // A vetoed identity update can leave stale profile fields after an unlink.
  // Only a linked account, never the cached profile field alone, grants access.
  const accounts = (await ctx.context.internalAdapter.findAccounts(
    userId
  )) as TelegramAccount[];
  return accounts.some(
    (account) =>
      (account.providerId === PLUGIN_ID && account.accountId === telegramId) ||
      (account.providerId === TELEGRAM_OIDC_PROVIDER_ID &&
        account.telegramId === telegramId)
  );
}

/** Same-owner legacy duplicates are harmless; different owners are ambiguous. */
export async function findTelegramAccount(
  ctx: GenericEndpointContext,
  telegramId: string
) {
  const adapter = await getCurrentAdapter(ctx.context.adapter);
  const where = [
    { field: "providerId", value: PLUGIN_ID },
    { field: "accountId", value: telegramId },
  ];
  const [account, duplicate] = await adapter.findMany<TelegramAccount>({
    model: "account",
    where,
    limit: 2,
  });
  if (!(account && duplicate)) {
    return account ?? null;
  }
  // The common single-row case needs one read. Same-owner legacy duplicates
  // need a separate check: the first two rows could hide a third owner.
  if (
    duplicate.userId !== account.userId ||
    (await adapter.findOne({
      model: "account",
      where: [
        ...where,
        { field: "userId", value: account.userId, operator: "ne" },
      ],
    }))
  ) {
    throw APIError.from("CONFLICT", ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER);
  }
  return account;
}

/**
 * Runs the app's `user.validateUserInfo` gate for actions Better Auth's
 * internal adapter does not cover (`create-user` is checked by `createUser`).
 * Fails closed, like Better Auth's own gate.
 */
export async function assertValidUserInfo(
  ctx: GenericEndpointContext,
  user: TelegramUser,
  action: "sign-in" | "link-account",
  method: TelegramProvisioningMethod
) {
  const validate = ctx.context.options.user?.validateUserInfo;
  if (!validate) {
    return;
  }
  let result: Awaited<ReturnType<typeof validate>>;
  try {
    result = await validate({ user, source: { method, action } }, ctx);
  } catch (error) {
    ctx.context.logger.error("validateUserInfo callback threw", error);
    throw new APIError("FORBIDDEN", {
      code: "validation_failed",
      message: "User validation failed",
      cause: error,
    });
  }
  if (result?.error) {
    throw new APIError("FORBIDDEN", {
      code: result.error,
      message: result.errorDescription || result.error,
    });
  }
}

/** Identity and user operations in progress, per Better Auth instance. */
const inProgress = new WeakMap<object, Map<string, Promise<unknown>>>();

/**
 * Runs `task` once every earlier task for the same operation key on this
 * Better Auth instance has settled. A double-submitted first sign-in (React
 * strict mode, a double click) would otherwise create the user twice, or
 * link a second account to the user the first request just created.
 */
export async function withTelegramOperation<T>(
  ctx: GenericEndpointContext,
  operationKey: string,
  task: () => Promise<T>
): Promise<T> {
  const key = ctx.context.adapter;
  let tasks = inProgress.get(key);
  if (!tasks) {
    tasks = new Map();
    inProgress.set(key, tasks);
  }
  const current = (tasks.get(operationKey) ?? Promise.resolve()).then(task);
  const settled = current.then(
    () => undefined,
    () => undefined
  );
  tasks.set(operationKey, settled);
  try {
    return await current;
  } finally {
    if (tasks.get(operationKey) === settled) {
      tasks.delete(operationKey);
    }
  }
}
