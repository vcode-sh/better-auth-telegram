import {
  getCurrentAdapter,
  tryGetCurrentAuthEndpointContext,
} from "@better-auth/core/context";
import { createPlaceholderEmail } from "@better-auth/core/utils/email";
import {
  PLACEHOLDER_EMAIL_DOMAINS,
  PLUGIN_ID,
  TELEGRAM_OIDC_PROVIDER_ID,
} from "./constants";
import { currentClaims } from "./telegram-identity-state";

function oidcEmail(identifier: string) {
  return createPlaceholderEmail({
    identifier,
    namespace: TELEGRAM_OIDC_PROVIDER_ID,
  });
}

function directOIDCEmail(sub: string): string | null {
  if (sub.length > 64) {
    return null;
  }
  try {
    return oidcEmail(sub);
  } catch {
    return null;
  }
}

async function opaqueSubjectKey(sub: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sub)
  );
  // This is only an email-safe label, never the account identity. Leave room
  // for collision suffixes while retaining 192 bits of the subject's digest.
  return `h-${Array.from(new Uint8Array(digest).slice(0, 24), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

function matchesIdentifier(identifier: string, base: string) {
  const lower = base.toLowerCase();
  return identifier === lower || identifier.startsWith(`${lower}.`);
}

/**
 * `<identifier>@<namespace>.placeholder.invalid` addresses are the plugin's.
 * Returns the identifier when `email` is one of them.
 */
function placeholderIdentifier(
  email: unknown
): { identifier: string; namespace: string } | null {
  if (typeof email !== "string") {
    return null;
  }
  const lower = email.toLowerCase();
  for (const [namespace, domain] of Object.entries(PLACEHOLDER_EMAIL_DOMAINS)) {
    if (lower.endsWith(`@${domain}`)) {
      return { identifier: lower.slice(0, -domain.length - 1), namespace };
    }
  }
  return null;
}

/**
 * Only the Telegram flows may create users with Telegram placeholder emails:
 * otherwise anyone could register `<telegramId>@telegram.placeholder.invalid`
 * with a password and block (or pre-claim) that Telegram user's account.
 */
export async function isAllowedPlaceholder(user: Record<string, unknown>) {
  const placeholder = placeholderIdentifier(user.email);
  if (!placeholder) {
    return true;
  }
  if (placeholder.namespace === PLUGIN_ID) {
    // `<id>` or, after the user holding `<id>` unlinked Telegram, `<id>.<suffix>`.
    const telegramId = String(user.telegramId ?? "");
    return (
      telegramId !== "" &&
      (placeholder.identifier === telegramId ||
        placeholder.identifier.startsWith(`${telegramId}.`))
    );
  }
  const subject = (await currentClaims())?.sub;
  if (subject === undefined) {
    return false;
  }
  if (
    directOIDCEmail(subject) &&
    matchesIdentifier(placeholder.identifier, subject)
  ) {
    return true;
  }
  return matchesIdentifier(
    placeholder.identifier,
    await opaqueSubjectKey(subject)
  );
}

/** Keep placeholder selection and reservation together so emails never prove identity. */
export async function oidcPlaceholderEmail(sub: string): Promise<string> {
  const direct = directOIDCEmail(sub);
  const identifier = direct ? sub : await opaqueSubjectKey(sub);
  const email = direct ?? oidcEmail(identifier);
  const ctx = tryGetCurrentAuthEndpointContext()?.context;
  if (!ctx) {
    return email;
  }
  const adapter = await getCurrentAdapter(ctx.adapter);
  // Existence only: Better Auth resolves ownership later and rejects duplicate
  // identities there. Placeholder selection must not throw ahead of that check.
  if (
    await adapter.findOne({
      model: "account",
      where: [
        { field: "providerId", value: TELEGRAM_OIDC_PROVIDER_ID },
        { field: "accountId", value: sub },
      ],
    })
  ) {
    return email;
  }
  // An unlinked user keeps their email. It cannot prove ownership of a new
  // OIDC account, even if the app trusts Telegram for email-based linking.
  if (await ctx.internalAdapter.findUserByEmail(email)) {
    const suffix = crypto.randomUUID();
    if (identifier.length + suffix.length + 1 <= 64) {
      return oidcEmail(`${identifier}.${suffix}`);
    }
    const base = direct ? await opaqueSubjectKey(sub) : identifier;
    return oidcEmail(`${base}.${suffix.replaceAll("-", "").slice(0, 13)}`);
  }
  return email;
}
