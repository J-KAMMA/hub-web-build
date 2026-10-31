import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const separateTypecheck = process.env.HUB_BUILD_SEPARATE_TYPECHECK === "true";

if (separateTypecheck) {
  const tscCli = require.resolve("typescript/bin/tsc");
  const typecheck = spawnSync(
    process.execPath,
    [tscCli, "--noEmit", "--incremental", "false", "-p", "tsconfig.next-build.json"],
    { stdio: "inherit", env: process.env },
  );

  if (typecheck.error) {
    console.error(typecheck.error.message);
    process.exit(1);
  }
  if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);
}

const result = spawnSync(process.execPath, [nextCli, "build", "--webpack"], {
  stdio: "inherit",
  env: {
    ...process.env,
    // Next compiles rewrites during the build. The standard Node artifact is
    // the VPS development runtime, so its isolated loopback services must be
    // present in the generated route manifest. Cloudflare uses the separate
    // build:cloudflare script and edge routing instead.
    HUB_ENABLE_LOCAL_SERVICE_REWRITES:
      process.env.HUB_ENABLE_LOCAL_SERVICE_REWRITES ?? "true",
    HUB_AI_DEV_ORIGIN:
      process.env.HUB_AI_DEV_ORIGIN
      ?? "https://jkamma-ai-staging.jammakamma0.workers.dev",
  },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
