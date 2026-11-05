import { appendFileSync, chmodSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export function fingerprint(value: unknown) {
  return typeof value === "string"
    ? createHash("sha256").update(value).digest("hex").slice(0, 12)
    : null;
}

export function createLog(path: string) {
  appendFileSync(path, "", { mode: 0o600 });
  chmodSync(path, 0o600);
  return (event: string, details: Record<string, unknown> = {}) => {
    appendFileSync(
      path,
      `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`
    );
  };
}

export function readControl(path?: string) {
  if (!path)
    return {
      deny: false,
      profileVersion: 1,
      revokeOnValidation: false,
      revokeOnCreate: false,
    };
  const value = JSON.parse(readFileSync(path, "utf8"));
  return {
    deny: value.deny === true,
    profileVersion: value.profileVersion === 2 ? 2 : 1,
    revokeOnValidation: value.revokeOnValidation === true,
    revokeOnCreate: value.revokeOnCreate === true,
  };
}

export const memberFields = [
  "user_id",
  "user_name",
  "user_nick",
  "role",
  "nickname",
];
export function safeUser(user: Record<string, unknown> | null | undefined) {
  if (!user) return null;
  return {
    userFingerprint: fingerprint(user.id),
    telegramFingerprint: fingerprint(user.telegramId),
    hasTelegramUsername: !!user.telegramUsername,
    hasTelegramPhone: !!user.telegramPhoneNumber,
    ...Object.fromEntries(memberFields.map((key) => [key, user[key] ?? null])),
  };
}

export function safeSession(
  session: Record<string, unknown> | null | undefined
) {
  if (!session) return null;
  return {
    userFingerprint: fingerprint(session.userId),
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    ...Object.fromEntries(
      memberFields.map((key) => [key, session[key] ?? null])
    ),
  };
}
