import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/index.ts", // Server plugin requires Better Auth runtime
        "src/types.ts", // Type definitions only
        "node_modules/**",
        "dist/**",
      ],
      thresholds: {
        lines: 90,
        functions: 80,
        branches: 90,
        statements: 90,
      },
    },
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["node_modules", "dist"],
  },
});
