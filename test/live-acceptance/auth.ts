import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { telegram } from "../../dist/index.js";
import { fingerprint, readControl } from "./log";
import { createMemberPolicy, serverOwnedFields } from "./member";
import { legacyOptions } from "./legacy";

type Log = (event: string, details?: Record<string, unknown>) => void;
export interface Credentials {
  oidcClientId: string;
  oidcClientSecret: string;
  legacyBotToken?: string;
  legacyBotUsername?: string;
}
export const modes = ["trusted", "mapper", "database", "legacy"] as const;
export type Mode = (typeof modes)[number];

export async function createModes(
  baseURL: string,
  credentials: Credentials,
  log: Log
) {
  const secret =
    process.env.BAT_LIVE_AUTH_SECRET ?? randomBytes(32).toString("hex");
  const close: (() => void)[] = [];
  const instances = new Map<Mode, ReturnType<typeof betterAuth>>();
  try {
    for (const mode of modes) {
      if (
        mode === "legacy" &&
        !(credentials.legacyBotToken && credentials.legacyBotUsername)
      )
        continue;
      const policy = createMemberPolicy(mode, log);
      const sqlite =
        mode === "database" || mode === "legacy"
          ? new DatabaseSync(":memory:")
          : undefined;
      if (sqlite)
        close.push(() => {
          if (sqlite.isOpen) sqlite.close();
        });
      if (mode === "legacy") {
        const options = legacyOptions(
          baseURL,
          secret,
          sqlite!,
          credentials,
          log
        );
        await (await getMigrations(options)).runMigrations();
        instances.set(mode, betterAuth(options));
        continue;
      }
      const options: BetterAuthOptions = {
        baseURL,
        basePath: `/${mode}/api/auth`,
        secret,
        trustedOrigins: [baseURL],
        database: sqlite,
        logger: {
          log(level: string, _message: string, ..._args: unknown[]) {
            log("auth_diagnostic", { mode, level });
          },
        },
        advanced: { cookiePrefix: `bat_live_${mode}` },
        account: {
          storeStateStrategy: "cookie",
          storeAccountCookie: true,
          updateAccountOnSignIn: mode !== "database",
        },
        session: {
          expiresIn: 300,
          ...(mode === "trusted"
            ? { additionalFields: serverOwnedFields }
            : {}),
          cookieCache: {
            enabled: true,
            strategy: "jwt",
            maxAge: 300,
            refreshCache: false,
          },
        },
        user: {
          additionalFields: {
            ...serverOwnedFields,
            nickname: { type: "string", required: false },
          },
          validateUserInfo: policy.validateUserInfo,
        },
        databaseHooks: {
          user: {
            create: {
              async before() {
                if (mode === "mapper") return;
                return policy.fieldsForCreation("user");
              },
            },
          },
          account: {
            create: {
              async after(account: any, ctx: any) {
                log("account_created", {
                  mode,
                  providerId: account.providerId,
                  userFingerprint: fingerprint(account.userId),
                });
                if (
                  readControl(process.env.BAT_LIVE_CONTROL_FILE).revokeOnCreate
                ) {
                  await ctx.context.internalAdapter.deleteAccount(account.id);
                  log("account_revoked_in_create_hook", { mode });
                }
              },
            },
          },
          session: {
            create: {
              async before() {
                if (mode === "trusted")
                  return policy.fieldsForCreation("session");
              },
              async after() {
                log("session_created", { mode });
              },
            },
          },
        },
        plugins: [
          telegram({
            loginWidget: false,
            oidc: {
              enabled: true,
              clientId: credentials.oidcClientId,
              clientSecret: credentials.oidcClientSecret,
              updateUserInfoOnSignIn: mode === "database",
              async mapOIDCProfileToUser(claims) {
                const control = readControl(process.env.BAT_LIVE_CONTROL_FILE);
                log("verified_oidc_profile", {
                  mode,
                  idType: typeof claims.id,
                  subjectType: typeof claims.sub,
                  audienceType: typeof claims.aud,
                  hasPhone: claims.phone_number !== undefined,
                  telegramFingerprint: fingerprint(claims.id),
                });
                await Promise.resolve();
                return {
                  user_id: 999,
                  user_name: "Mapper Test",
                  user_nick: "mapper",
                  role: "admin",
                  nickname: `profile-v${control.profileVersion}`,
                };
              },
            },
          }),
        ],
      };
      if (sqlite) await (await getMigrations(options)).runMigrations();
      instances.set(mode, betterAuth(options));
    }
    return { instances, close: () => close.forEach((fn) => fn()) };
  } catch (error) {
    close.forEach((fn) => fn());
    throw error;
  }
}
