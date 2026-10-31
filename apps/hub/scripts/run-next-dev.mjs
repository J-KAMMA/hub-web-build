import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const hubRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const varsPath = path.join(hubRoot, ".dev.vars");

if (existsSync(varsPath)) {
  loadEnvFile(varsPath);
}

// The 3020 dev Hub stands in for the jkamma instance. Hub B (dev-hub-b.mjs) passes "0" to run as a
// self-hosted Hub. The Edge proxy reads process.env, not the wrangler vars, so set it here.
process.env.HUB_JKAMMA_SERVICES ??= "1";
/* Local dev keeps the review-gated features on; production leaves them unset (default off). */
process.env.HUB_WORK_COMMISSIONS_ENABLED ??= "true";
process.env.HUB_RESEARCH_TOKEN_ENABLED ??= "true";

const nextBin = path.resolve(hubRoot, "../../node_modules/next/dist/bin/next");
// 2026-10-16: Turbopack is the default. Measured on the same six /v2 pages: webpack settled 4.7 GB (peak 4.7 GB),
// Turbopack settled 1.0 GB (peak 2.5 GB), all 200. HUB_DEV_BUNDLER=webpack restores webpack.
const bundler = process.env.HUB_DEV_BUNDLER === "webpack" ? "--webpack" : "--turbopack";

/*
 * --as <profileId>: 開発サーバーを別の利用者として立てる（2026-09-08、旦那様の許可）。
 *
 * 開発中のログイン省略（lib/server/hub-session.ts の HUB_DEV_SESSION_PROFILE_ID）は
 * 1つのプロフィールしか指せない。応募者と募集側のように2人の操作を通しで確かめるには、
 * 役を替えてサーバーを立て直すしかない。.env.development.local を書き換えずに済むよう、
 * 引数で上書きする。本番では効かない（hub-session.ts の3条件はそのまま）。
 */
const rawArgs = process.argv.slice(2);
const asIndex = rawArgs.indexOf("--as");
if (asIndex >= 0) {
  const profileId = rawArgs[asIndex + 1];
  if (!profileId) {
    console.error("--as にはプロフィールIDが要る。");
    process.exit(1);
  }
  process.env.HUB_DEV_SESSION_PROFILE_ID = profileId;
  rawArgs.splice(asIndex, 2);
  console.log(`Hub dev session as profile ${profileId}`);
}
const forwardedArgs = rawArgs;
const bundlerArgs = forwardedArgs.some((arg) => arg === "--turbopack" || arg === "--webpack")
  ? []
  : [bundler];
const child = spawn(
  process.execPath,
  [nextBin, "dev", ...bundlerArgs, ...forwardedArgs],
  {
    cwd: hubRoot,
    env: process.env,
    stdio: "inherit",
  },
);

/*
 * 起動直後の温め（2026-10-11）。next dev は道を初めて開いたときに組み立てるので、
 * Hub Desktop で起動後に最初に開く画面が10秒以上待たされていた。準備ができたら、
 * Desktop がよく使う道を1本ずつ一度だけ開いておく（同時に開くと開発サーバーが詰まる）。
 * 認証の要る道は 401 で返るが、組み立ては済む。HUB_DEV_WARM=0 で止められる。
 */
const WARM_PATHS = [
  "/api/health",
  "/api/client/me?posts=0",
  "/api/client/social-stream?filter=post&scope=latest&limit=1",
  "/api/client/feed?scope=popular&limit=1",
  "/api/client/notifications",
  "/api/client/conversations",
  "/api/client/wallet",
  "/api/client/music/library",
  "/api/client/videos/library",
  "/api/client/articles/saved",
  "/api/client/settings",
  "/v2",
];
function devPort(args) {
  const index = args.findIndex((arg) => arg === "-p" || arg === "--port");
  const value = index >= 0 ? Number(args[index + 1]) : Number(process.env.PORT || 3000);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : 3000;
}
async function warmRoutes(port) {
  const origin = `http://localhost:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(60000) })).ok) break; } catch { /* まだ起動中 */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const started = Date.now();
  let warmed = 0;
  for (const route of WARM_PATHS) {
    if (child.exitCode !== null) return;
    try { await (await fetch(origin + route, { signal: AbortSignal.timeout(120000) })).arrayBuffer(); warmed += 1; } catch { /* 温めの失敗は無視する */ }
  }
  console.log(`[hub-dev] warmed ${warmed}/${WARM_PATHS.length} routes in ${Math.round((Date.now() - started) / 1000)}s`);
}
if (process.env.HUB_DEV_WARM !== "0") void warmRoutes(devPort(forwardedArgs));

child.on("error", (error) => {
  console.error(`Unable to start Hub development server: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
