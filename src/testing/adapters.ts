/**
 * Test-only: Better Auth on real databases for the adapter lane
 * (`npm run test:adapters`). Each database is read from an environment
 * variable; a database without one is skipped.
 *
 * Schemas come from Better Auth itself: its Kysely migrations for PostgreSQL
 * and MySQL, the `auth` CLI's generators for Drizzle and Prisma (then
 * drizzle-kit / prisma push them), none for MongoDB.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { generateDrizzleSchema, generatePrismaSchema } from "auth/api";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { MongoClient } from "mongodb";
import { createPool } from "mysql2/promise";
import pg from "pg";
import type { TelegramPluginOptions } from "../types";
import { type AuthOptions, baseOptions, createClient } from "./harness";

export const ADAPTER_ENV = {
  postgres: "BAT_TEST_POSTGRES_URL",
  mysql: "BAT_TEST_MYSQL_URL",
  mongodb: "BAT_TEST_MONGODB_URL",
} as const;

const GENERATED_DIR = join(
  process.cwd(),
  "node_modules",
  ".cache",
  "better-auth-telegram-adapters"
);

type Row = Record<string, any>;

export interface AdapterAuth {
  auth: ReturnType<typeof betterAuth>;
  client: ReturnType<typeof createClient>;
  close: () => Promise<void>;
  options: AuthOptions;
  /** Rows of a Better Auth model, read through the adapter (logical names). */
  rows: (model: "user" | "account" | "session") => Promise<Row[]>;
}

export interface AdapterLane {
  /**
   * Two servers can't create the same Telegram user twice: the schema has
   * unique indexes (MongoDB's has none) and the adapter writes the user and
   * account in one transaction (Drizzle and Prisma only with
   * `transaction: true`; this lane keeps their default, false).
   */
  concurrentServers: boolean;
  create: (
    pluginOptions?: Partial<TelegramPluginOptions>,
    authOptions?: Partial<AuthOptions>
  ) => Promise<AdapterAuth>;
  /**
   * `advanced.database.generateId` "serial" / "uuid" can run here (not on
   * MongoDB; the Prisma client is generated once, for the default ids).
   */
  generatedIds: boolean;
  name: string;
  /** Skipped when the database URL is not set. */
  url: string | undefined;
}

let databaseCounter = 0;
const uniqueName = () => {
  databaseCounter += 1;
  return `bat_${process.pid}_${Date.now().toString(36)}_${databaseCounter}`;
};

async function wrap(
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

/** A second Better Auth instance ("server") on the same database. */
export function attach(harness: AdapterAuth): Promise<AdapterAuth> {
  return wrap(harness.options, async () => undefined);
}

async function postgresDatabase(url: string) {
  const name = uniqueName();
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`create database "${name}"`);
  await admin.end();
  const databaseURL = new URL(url);
  databaseURL.pathname = `/${name}`;
  return databaseURL.toString();
}

function postgresLane(url: string | undefined): AdapterLane {
  return {
    name: "PostgreSQL (Kysely)",
    url,
    concurrentServers: true,
    generatedIds: true,
    async create(pluginOptions = {}, authOptions = {}) {
      const pool = new pg.Pool({
        connectionString: await postgresDatabase(url!),
        max: 10,
      });
      const options = {
        ...baseOptions(pluginOptions, authOptions),
        database: pool,
      };
      await (await getMigrations(options)).runMigrations();
      return wrap(options, () => pool.end());
    },
  };
}

function mysqlLane(url: string | undefined): AdapterLane {
  return {
    name: "MySQL (Kysely)",
    url,
    concurrentServers: true,
    generatedIds: true,
    async create(pluginOptions = {}, authOptions = {}) {
      const name = uniqueName();
      const admin = createPool({ uri: url!, connectionLimit: 1 });
      await admin.query(
        `create database \`${name}\` character set utf8mb4 collate utf8mb4_0900_ai_ci`
      );
      await admin.end();
      const databaseURL = new URL(url!);
      databaseURL.pathname = `/${name}`;
      // Better Auth's MySQL docs: timezone "Z".
      const pool = createPool({
        uri: databaseURL.toString(),
        timezone: "Z",
        connectionLimit: 10,
      });
      const options = {
        ...baseOptions(pluginOptions, authOptions),
        database: pool,
      };
      await (await getMigrations(options)).runMigrations();
      return wrap(options, () => pool.end());
    },
  };
}

function mongoLane(url: string | undefined): AdapterLane {
  return {
    name: "MongoDB",
    url,
    concurrentServers: false,
    generatedIds: false,
    async create(pluginOptions = {}, authOptions = {}) {
      const client = new MongoClient(url!);
      await client.connect();
      const db = client.db(uniqueName());
      // `client` enables transactions (the container runs a replica set).
      const options = {
        ...baseOptions(pluginOptions, authOptions),
        database: mongodbAdapter(db, { client }),
      };
      return wrap(options, async () => {
        await db.dropDatabase();
        await client.close();
      });
    },
  };
}

function drizzleLane(url: string | undefined): AdapterLane {
  return {
    name: "Drizzle (PostgreSQL)",
    url,
    concurrentServers: false,
    generatedIds: true,
    async create(pluginOptions = {}, authOptions = {}) {
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const { pushSchema } = await import("drizzle-kit/api");
      const pool = new pg.Pool({
        connectionString: await postgresDatabase(url!),
        max: 10,
      });
      const plain = baseOptions(pluginOptions, authOptions);
      // `npx auth generate` for Drizzle, written where drizzle-orm resolves.
      const generated = await generateDrizzleSchema({
        adapter: drizzleAdapter({}, { provider: "pg" })(plain),
        options: plain,
        file: "schema.ts",
      });
      mkdirSync(GENERATED_DIR, { recursive: true });
      const file = join(GENERATED_DIR, `${uniqueName()}.drizzle.ts`);
      writeFileSync(file, generated.code!);
      const schema = await import(pathToFileURL(file).href);
      const db = drizzle(pool, { schema });
      const { apply } = await pushSchema(schema, db as any);
      await apply();
      const options = {
        ...plain,
        database: drizzleAdapter(db, { provider: "pg", schema }),
      };
      return wrap(options, () => pool.end());
    },
  };
}

/**
 * Prisma generates one client per schema, so this lane runs the default
 * options only and empties the tables between tests.
 */
function prismaLane(url: string | undefined): AdapterLane {
  let ready: Promise<{ PrismaClient: any; databaseURL: string }> | undefined;
  const prepare = async () => {
    const databaseURL = await postgresDatabase(url!);
    const plain = baseOptions({ miniApp: { enabled: true } }, {});
    mkdirSync(GENERATED_DIR, { recursive: true });
    const schemaFile = join(GENERATED_DIR, "schema.prisma");
    // The generator edits an existing file; start from none, like a new app.
    rmSync(schemaFile, { force: true });
    const generated = await generatePrismaSchema({
      adapter: prismaAdapter({}, { provider: "postgresql" })(plain),
      options: plain,
      file: schemaFile,
    });
    writeFileSync(schemaFile, generated.code!);
    const env = { ...process.env, DATABASE_URL: databaseURL };
    const prisma = (...args: string[]) =>
      execFileSync("npx", ["prisma", ...args, `--schema=${schemaFile}`], {
        env,
        stdio: "pipe",
      });
    prisma("db", "push", "--skip-generate", "--accept-data-loss");
    prisma("generate");
    // This schema's client only exists after generate; a clean checkout's
    // type-check must not depend on a previously generated database client.
    const clientModule = "@prisma/client";
    const { PrismaClient } = await import(clientModule);
    return { PrismaClient, databaseURL };
  };
  return {
    name: "Prisma (PostgreSQL)",
    url,
    concurrentServers: false,
    generatedIds: false,
    async create(pluginOptions = {}, authOptions = {}) {
      ready ??= prepare();
      const { PrismaClient, databaseURL } = await ready;
      const prisma = new PrismaClient({ datasourceUrl: databaseURL });
      // Children first: session and account reference user.
      await prisma.$transaction([
        prisma.session.deleteMany(),
        prisma.account.deleteMany(),
        prisma.verification.deleteMany(),
        prisma.user.deleteMany(),
      ]);
      const options = {
        ...baseOptions(
          { miniApp: { enabled: true }, ...pluginOptions },
          authOptions
        ),
        database: prismaAdapter(prisma, { provider: "postgresql" }),
      };
      return wrap(options, () => prisma.$disconnect());
    },
  };
}

export function adapterLanes(): AdapterLane[] {
  const postgres = process.env[ADAPTER_ENV.postgres];
  return [
    postgresLane(postgres),
    mysqlLane(process.env[ADAPTER_ENV.mysql]),
    mongoLane(process.env[ADAPTER_ENV.mongodb]),
    drizzleLane(postgres),
    prismaLane(postgres),
  ];
}
