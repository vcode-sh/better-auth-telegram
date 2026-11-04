import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { PrismaPg } from "@prisma/adapter-pg";
import { generatePrismaSchema } from "auth/api";
import { afterAll } from "vitest";
import {
  type AdapterLane,
  generatedDirectory,
  postgresDatabase,
  wrap,
} from "./adapter-resources";
import { baseOptions } from "./auth";

/** Generate one client per suite; isolate its files and database from concurrent runs. */
export function prismaLane(url: string | undefined): AdapterLane {
  const prepare = async () => {
    const database = await postgresDatabase(url!);
    try {
      const plain = baseOptions({ miniApp: { enabled: true } }, {});
      const directory = mkdtempSync(join(generatedDirectory(), "prisma-"));
      const schemaFile = join(directory, "schema.prisma");
      // Prisma 7 stores the URL outside the schema and requires an output directory.
      writeFileSync(
        schemaFile,
        `generator client {\n  provider = "prisma-client"\n  output   = "./prisma-client"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n`
      );
      const generated = await generatePrismaSchema({
        adapter: prismaAdapter({}, { provider: "postgresql" })(plain),
        options: plain,
        file: schemaFile,
      });
      writeFileSync(schemaFile, generated.code!);
      const prisma = (...args: string[]) =>
        execFileSync("npx", ["prisma", ...args, `--schema=${schemaFile}`], {
          stdio: "pipe",
        });
      prisma("db", "push", `--url=${database.url}`);
      prisma("generate");
      const { PrismaClient } = await import(
        pathToFileURL(join(directory, "prisma-client/client.ts")).href
      );
      return { PrismaClient, database };
    } catch (error) {
      await database.drop();
      throw error;
    }
  };
  let ready: ReturnType<typeof prepare> | undefined;
  afterAll(async () => {
    const prepared = await ready?.catch(() => undefined);
    if (prepared) {
      await prepared.database.drop();
    }
  });
  return {
    name: "Prisma (PostgreSQL)",
    url,
    concurrentServers: false,
    generatedIds: false,
    async create(pluginOptions = {}, authOptions = {}) {
      ready ??= prepare();
      const { PrismaClient, database } = await ready;
      const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: database.url }),
      });
      try {
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
        return await wrap(options, () => prisma.$disconnect());
      } catch (error) {
        await prisma.$disconnect();
        throw error;
      }
    },
  };
}
