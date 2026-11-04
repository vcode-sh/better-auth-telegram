/** Real database fixtures use Better Auth migrations and its generated ORM schemas. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { generateDrizzleSchema } from "auth/api";
import { getMigrations } from "better-auth/db/migration";
import { MongoClient } from "mongodb";
import { createPool } from "mysql2/promise";
import pg from "pg";
import { prismaLane } from "./adapter-prisma";
import {
  type AdapterAuth,
  type AdapterLane,
  generatedDirectory,
  mysqlDatabase,
  postgresDatabase,
  uniqueName,
  wrap,
} from "./adapter-resources";
import { baseOptions } from "./auth";

export type { AdapterAuth, AdapterLane } from "./adapter-resources";

export const ADAPTER_ENV = {
  postgres: "BAT_TEST_POSTGRES_URL",
  mysql: "BAT_TEST_MYSQL_URL",
  mongodb: "BAT_TEST_MONGODB_URL",
} as const;

/** A second Better Auth instance sharing the first instance's owned database. */
export function attach(harness: AdapterAuth): Promise<AdapterAuth> {
  return wrap(harness.options, async () => undefined);
}

function postgresLane(url: string | undefined): AdapterLane {
  return {
    name: "PostgreSQL (Kysely)",
    url,
    concurrentServers: true,
    generatedIds: true,
    async create(pluginOptions = {}, authOptions = {}) {
      const database = await postgresDatabase(url!);
      const pool = new pg.Pool({ connectionString: database.url, max: 10 });
      const close = async () => {
        try {
          await pool.end();
        } finally {
          await database.drop();
        }
      };
      try {
        const options = {
          ...baseOptions(pluginOptions, authOptions),
          database: pool,
        };
        await (await getMigrations(options)).runMigrations();
        return await wrap(options, close);
      } catch (error) {
        await close();
        throw error;
      }
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
      const database = await mysqlDatabase(url!);
      // Match Better Auth's documented UTC timezone setting.
      const pool = createPool({
        uri: database.url,
        timezone: "Z",
        connectionLimit: 10,
      });
      const close = async () => {
        try {
          await pool.end();
        } finally {
          await database.drop();
        }
      };
      try {
        const options = {
          ...baseOptions(pluginOptions, authOptions),
          database: pool,
        };
        await (await getMigrations(options)).runMigrations();
        return await wrap(options, close);
      } catch (error) {
        await close();
        throw error;
      }
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
      try {
        await client.connect();
      } catch (error) {
        await client.close();
        throw error;
      }
      const db = client.db(uniqueName());
      const close = async () => {
        try {
          await db.dropDatabase();
        } finally {
          await client.close();
        }
      };
      try {
        const options = {
          ...baseOptions(pluginOptions, authOptions),
          database: mongodbAdapter(db, { client }),
        };
        return await wrap(options, close);
      } catch (error) {
        await close();
        throw error;
      }
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
      const database = await postgresDatabase(url!);
      const pool = new pg.Pool({ connectionString: database.url, max: 10 });
      const close = async () => {
        try {
          await pool.end();
        } finally {
          await database.drop();
        }
      };
      try {
        const plain = baseOptions(pluginOptions, authOptions);
        const generated = await generateDrizzleSchema({
          adapter: drizzleAdapter({}, { provider: "pg" })(plain),
          options: plain,
          file: "schema.ts",
        });
        const file = join(generatedDirectory(), `${uniqueName()}.drizzle.ts`);
        writeFileSync(file, generated.code!);
        const schema = await import(pathToFileURL(file).href);
        const db = drizzle(pool, { schema });
        const { apply } = await pushSchema(schema, db as any);
        await apply();
        return await wrap(
          {
            ...plain,
            database: drizzleAdapter(db, { provider: "pg", schema }),
          },
          close
        );
      } catch (error) {
        await close();
        throw error;
      }
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
