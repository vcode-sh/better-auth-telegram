import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
  },
  format: ["esm", "cjs"],
  platform: "neutral",
  // Keep the published file names: index.js / index.cjs, index.d.ts / index.d.cts.
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  clean: true,
  // better-auth, @better-auth/core and jose stay external (peer/dependency).
  // Endpoint types come from better-call, which is not our dependency; they
  // are inlined into the .d.ts files so they resolve under strict installs.
  deps: { onlyBundle: ["better-call", "rou3"] },
  publint: true,
  attw: { profile: "node16", level: "error" },
});
