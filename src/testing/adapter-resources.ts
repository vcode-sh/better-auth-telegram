import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import { createPool } from "mysql2/promise";
import pg from "pg";
import { afterAll } from "vitest";
import type { TelegramPluginOptions } from "../types";
import type { AuthOptions } from "./auth";
import { createClient } from "./http-client";

type Row = Record<string, any>;

export interface AdapterAuth {
  auth: ReturnType<typeof betterAuth>;
  client: ReturnType<typeof createClient>;
  close: () => Promise<void>;
  options: AuthOptions;
  rows: (model: "user" | "account" | "session") => Promise<Row[]>;
}

export interface AdapterLane {
  /** Requires unique user.email and transactions spanning user/account creation. */
  concurrentServers: boolean;
  create: (
    pluginOptions?: Partial<TelegramPluginOptions>,
    authOptions?: Partial<AuthOptions>
  ) => Promise<AdapterAuth>;
  /** Whether this adapter supports the serial/UUID fixtures. */
  generatedIds: boolean;
  name: string;
  url: string | undefined;
}

let databaseCounter = 0;
export const uniqueName = () => {
  databaseCounter += 1;
  return `bat_${process.pid}_${Date.now().toString(36)}_${databaseCounter}`;
};

let generated: string | undefined;
export function generatedDirectory() {
  if (!generated) {
    const root = join(
      process.cwd(),
      "node_modules",
      ".cache",
      "better-auth-telegram-adapters"
    );
    mkdirSync(root, { recursive: true });
    generated = mkdtempSync(join(root, `${process.pid}-`));
  }
  return generated;
}

afterAll(() => {
  if (generated) {
    rmSync(generated, { recursive: true, force: true });
  }
});

export async function wrap(
  options: AuthOptions,
  close: () => Promise<void>
): Promise<AdapterAuth> {
  const auth = betterAuth(options);
  const context = await auth.$context;
  return {
    auth,
    client: createClient(auth),
    rows: (model) => context.adapter.findMany<Row>({ model }),
    close,
    options,
  };
}

/** Only generated databases are dropped; the URL's original database is never modified. */
export async function postgresDatabase(url: string) {
  const name = uniqueName();
  const execute = async (sql: string) => {
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    try {
      await admin.query(sql);
    } finally {
      await admin.end();
    }
  };
  await execute(`create database "${name}"`);
  const databaseURL = new URL(url);
  databaseURL.pathname = `/${name}`;
  return {
    url: databaseURL.toString(),
    drop: () => execute(`drop database if exists "${name}"`),
  };
}

export async function mysqlDatabase(url: string) {
  const name = uniqueName();
  const execute = async (sql: string) => {
    const admin = createPool({ uri: url, connectionLimit: 1 });
    try {
      await admin.query(sql);
    } finally {
      await admin.end();
    }
  };
  await execute(
    `create database \`${name}\` character set utf8mb4 collate utf8mb4_0900_ai_ci`
  );
  const databaseURL = new URL(url);
  databaseURL.pathname = `/${name}`;
  return {
    url: databaseURL.toString(),
    drop: () => execute(`drop database if exists \`${name}\``),
  };
}
