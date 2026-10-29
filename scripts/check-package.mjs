import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const packResult = JSON.parse(
  execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
    encoding: "utf8",
  })
);
const packed = Array.isArray(packResult)
  ? packResult[0]
  : packResult[manifest.name];
for (const name of ["index", "client"]) {
  for (const extension of ["js", "cjs", "d.ts", "d.cts"]) {
    assert(
      packed.files.some((file) => file.path === `dist/${name}.${extension}`)
    );
  }
}
assert(!packed.files.some((file) => /(?:^|\/)\.env(?:\.|$)/u.test(file.path)));

// A fresh consumer outside the checkout cannot resolve missing dependencies
// from the repository's node_modules or accidentally import source files.
const consumer = mkdtempSync(join(tmpdir(), "better-auth-telegram-package-"));
try {
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "better-auth-telegram": `file:${resolve(packed.filename)}`,
        "better-auth": manifest.devDependencies["better-auth"],
        "@better-auth/core": manifest.devDependencies["@better-auth/core"],
      },
      devDependencies: {
        typescript: manifest.devDependencies.typescript,
        "@types/node": manifest.devDependencies["@types/node"],
      },
    })
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ],
    {
      cwd: consumer,
      stdio: "inherit",
    }
  );
  cpSync("test-d", join(consumer, "test-d"), { recursive: true });
  const tsc = join(consumer, "node_modules/typescript/bin/tsc");
  for (const config of [
    "test-d/tsconfig.json",
    "test-d/tsconfig.node16.json",
  ]) {
    execFileSync(process.execPath, [tsc, "-p", config], {
      cwd: consumer,
      stdio: "inherit",
    });
  }
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import assert from "node:assert/strict";
    import { createHash, createHmac } from "node:crypto";
    import { betterAuth } from "better-auth";
    import { memoryAdapter } from "better-auth/adapters/memory";
    import { telegram } from "better-auth-telegram";
    import { telegramClient } from "better-auth-telegram/client";
    assert.equal(typeof telegramClient, "function");
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "package-consumer-test-secret-0123456789abcdef",
      database: memoryAdapter({ user: [], account: [], session: [], verification: [] }),
      plugins: [telegram({ botToken: "123456789:package_test_token", botUsername: "test_bot" })],
    });
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/telegram/config"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).botUsername, "test_bot");
    const data = { id: 42, first_name: "Ann", auth_date: Math.floor(Date.now() / 1000) };
    const signed = Object.keys(data).sort().map((key) => key + "=" + data[key]).join("\\n");
    const key = createHash("sha256").update("123456789:package_test_token").digest();
    const hash = createHmac("sha256", key).update(signed).digest("hex");
    const signIn = await auth.handler(new Request("http://localhost:3000/api/auth/telegram/signin", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ ...data, hash }),
    }));
    assert.equal(signIn.status, 200);
    const session = await signIn.json();
    assert.equal(session.user.telegramId, "42");
    assert.equal(typeof session.session.token, "string");
  `,
    ],
    { cwd: consumer, stdio: "inherit" }
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "--eval",
      `
    const assert = require("node:assert/strict");
    assert.equal(typeof require("better-auth-telegram").telegram, "function");
    assert.equal(typeof require("better-auth-telegram/client").telegramClient, "function");
  `,
    ],
    { cwd: consumer, stdio: "inherit" }
  );
  console.log(
    `Verified ${packed.filename}: installed ESM, CommonJS and consumer types on ${process.version}.`
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
