import { defineConfig } from "vitest/config";

/**
 * Adapter lane: the core flows against real databases. Each database is
 * skipped unless its URL is set:
 *
 *   BAT_TEST_POSTGRES_URL  postgres://user:pass@127.0.0.1:5432/db (also Drizzle, Prisma)
 *   BAT_TEST_MYSQL_URL     mysql://root:pass@127.0.0.1:3306/db (needs CREATE DATABASE)
 *   BAT_TEST_MONGODB_URL   mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.adapter.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
