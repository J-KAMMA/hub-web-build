import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, renameSync } from "node:fs";

if (process.platform === "win32") {
  console.error(
    "Cloudflare/OpenNext bundling is not supported from native Windows. Run this command in Linux, WSL 2, or Linux CI.",
  );
  process.exit(1);
}

/*
 * The 3D world's carved streets live in apps/hub-world and are copied in, not
 * committed twice. This must run here rather than in `prebuild`: the deploy
 * script calls `build:hub:cloudflare`, which never triggers `prebuild`, so the
 * first staging deploy shipped a Worker that answered 404 for every .glb.
 */
spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "copy-world-assets.mjs")], {
  stdio: "inherit",
});

// OpenNext must own the complete build. It sets Next's standalone tracing
// flags and applies runtime patches before bundling for workerd.
// Run it from the monorepo root so OpenNext and Next agree on the package path
// inside `.next/standalone`.
const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const appLock = resolve(workspaceRoot, "apps/hub/package-lock.json");
const parkedAppLock = `${appLock}.opennext-build`;
// Next 16 pins proxy.ts to the Node.js runtime and rejects any runtime export
// in it, while @opennextjs/cloudflare refuses to bundle Node.js middleware.
// The Worker applies the same rules from lib/hub-request-policy.ts through
// custom-worker.ts, so the proxy is parked for the bundle and restored after.
const appProxy = resolve(workspaceRoot, "apps/hub/proxy.ts");
const parkedAppProxy = `${appProxy}.opennext-build`;
const allowedWranglerConfigs = new Set([
  "apps/hub/wrangler.jsonc",
  "apps/hub/wrangler.production.jsonc",
]);
const wranglerConfig =
  process.env.HUB_WRANGLER_CONFIG ?? "apps/hub/wrangler.production.jsonc";

if (!allowedWranglerConfigs.has(wranglerConfig)) {
  console.error(
    "HUB_WRANGLER_CONFIG must select a reviewed Hub Wrangler configuration",
  );
  process.exit(1);
}

// The repository intentionally has both a workspace lockfile and a legacy
// app-local lockfile. OpenNext treats the nearest lockfile as the tracing root,
// while Next is configured to trace from the workspace root. Park only the
// nested lock during bundling so both tools use the same root, then restore it.
if (existsSync(parkedAppLock) && !existsSync(appLock)) {
  renameSync(parkedAppLock, appLock);
}
if (existsSync(parkedAppProxy) && !existsSync(appProxy)) {
  renameSync(parkedAppProxy, appProxy);
}

let result;
try {
  if (existsSync(appLock)) {
    renameSync(appLock, parkedAppLock);
  }
  if (existsSync(appProxy)) {
    renameSync(appProxy, parkedAppProxy);
  }
  result = spawnSync(
    "opennextjs-cloudflare",
    [
      "build",
      "--openNextConfigPath",
      "apps/hub/open-next.config.ts",
      "--config",
      wranglerConfig,
    ],
    {
      cwd: workspaceRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: `${resolve(workspaceRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
        HUB_CLOUDFLARE_BUILD: "true",
        // The Hub route graph is large enough to exhaust the shared VPS when
        // Next selects its default worker count. Keep the portable default
        // conservative while allowing CI or larger builders to opt in to a
        // higher value explicitly.
        HUB_BUILD_CPUS: process.env.HUB_BUILD_CPUS ?? "1",
        NODE_OPTIONS:
          process.env.NODE_OPTIONS ?? "--max-old-space-size=3072",
      },
    },
  );
} finally {
  if (existsSync(parkedAppLock)) {
    renameSync(parkedAppLock, appLock);
  }
  if (existsSync(parkedAppProxy)) {
    renameSync(parkedAppProxy, appProxy);
  }
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status === 0) {
  /*
   * The Hubpedia seed, its claim graph and the novels are static assets, not
   * script (lib/server/worker-data.ts). OpenNext has just rebuilt the assets
   * directory, so they are copied in afterwards.
   */
  const { stageWorkerData } = await import("./stage-worker-data.mjs");
  for (const item of stageWorkerData()) console.log(`staged worker data ${item.name} (${item.bytes} bytes)`);
}

process.exit(result.status ?? 1);
