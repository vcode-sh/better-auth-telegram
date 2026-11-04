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
  const claims = await currentClaims();
  const subject = claims?.sub.toLowerCase();
  return (
    subject !== undefined &&
    (placeholder.identifier === subject ||
      placeholder.identifier.startsWith(`${subject}.`))
  );
}

/** Keep placeholder selection and reservation together so emails never prove identity. */
export async function oidcPlaceholderEmail(sub: string): Promise<string> {
  const email = createPlaceholderEmail({
    identifier: sub,
    namespace: TELEGRAM_OIDC_PROVIDER_ID,
  });
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
    return createPlaceholderEmail({
      identifier: `${sub}.${crypto.randomUUID()}`,
      namespace: TELEGRAM_OIDC_PROVIDER_ID,
    });
  }
  return email;
}
