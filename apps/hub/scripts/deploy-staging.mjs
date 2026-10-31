import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * One route to Cloudflare staging.
 *
 * GitHub Actions is the reviewed path, but it cannot run while the account's
 * Actions billing is suspended, and OpenNext refuses to bundle from native
 * Windows. That left the deployment as a sequence of manual steps, and every
 * manual run lost something: a workspace node_modules that was never copied,
 * CRLF line endings carried into a Linux checkout, a config edited on one side
 * of a two-directory copy. This script removes the copy entirely.
 *
 * The tree is exported with `git archive`, so what deploys is a committed ref,
 * with the line endings stored in the object database rather than whatever the
 * Windows checkout produced. The gates run in the same order as
 * .github/workflows/hub-staging-cloudflare.yml and none of them can be
 * skipped: nothing reaches Cloudflare unless typecheck, tests, the bundle, and
 * the dry run all pass.
 */

const hubRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(hubRoot, "../..");
const DISTRO = process.env.HUB_DEPLOY_WSL_DISTRO ?? "Ubuntu-24.04";
const REMOTE_ROOT = "$HOME/.hub-staging-build";
const args = process.argv.slice(2);
/*
 * One script, two destinations. Production is not a separate path that can
 * rot unexercised: the same gates, the same lock, the same logs, and only
 * the config and the worker name change. The flag is spelled out and the
 * destination is printed before anything runs, because deploying the right
 * thing to the wrong place looks identical to success.
 */
const isProduction = args.includes("--production");
const WRANGLER_CONFIG = isProduction
  ? "apps/hub/wrangler.production.jsonc"
  : "apps/hub/wrangler.jsonc";
const WORKER_NAME = isProduction ? "jkamma-hub" : "jkamma-hub-staging";

const CONFIG_BASENAME = WRANGLER_CONFIG.split("/").pop();
const shouldDeploy = args.includes("--deploy");
const refIndex = args.indexOf("--ref");
const ref = refIndex === -1 ? "HEAD" : args[refIndex + 1];

if (refIndex !== -1 && !ref) {
  fail("--ref needs a git ref, for example --ref fix/hub-navigation-home-mobile");
}

function fail(message) {
  console.error(`\n✘ ${message}\n`);
  process.exit(1);
}

function step(title) {
  console.log(`\n[1m── ${title}[0m`);
}

/*
 * Every remote command loads nvm first. A non-interactive `wsl bash -lc` finds
 * the Windows npm on the shared PATH before any Linux node, and that npm runs
 * Windows binaries against a Linux checkout.
 */
function wsl(script, { capture = false } = {}) {
  /*
   * `nvm use` puts the Linux node first. Without it a ~/bin/node shim that runs
   * Windows node.exe won the PATH, and npm ci over the \\wsl$ path rejected every
   * workspace link in the lockfile (2026-10-14).
   */
  const prelude = 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && { nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || true; };';
  /*
   * wsl.exe itself sometimes fails with Wsl/Service/E_UNEXPECTED (2026-10-25: four deploys in a row, likely while
   * another distro started with interop off). That is the service, not the step, so wait and try again a few times.
   * stderr is piped so the error can be recognised; wsl.exe writes it in UTF-16, hence the NUL strip.
   */
  for (let attempt = 1; ; attempt += 1) {
    // wsl.exe prints its own service errors on stdout, so both streams are piped and echoed after the call.
    const result = spawnSync(
      "wsl",
      ["-d", DISTRO, "-e", "bash", "-lc", `set -e; ${prelude} ${script}`],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    if (result.error) fail(`Could not run WSL: ${result.error.message}`);
    const stderr = (result.stderr ?? "").replace(/\0/g, "");
    const stdout = (result.stdout ?? "").replace(/\0/g, "");
    if (!capture && stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (/E_UNEXPECTED/.test(stderr + (capture ? stdout : stdout.slice(-2000))) && attempt < 4) {
      console.log(`  WSL did not answer (E_UNEXPECTED); retrying in 30 s (${attempt}/3)`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
      continue;
    }
    return capture ? { status: result.status, stdout: stdout.trim() } : result.status;
  }
}

function git(...gitArgs) {
  const result = spawnSync("git", ["-C", workspaceRoot, ...gitArgs], { encoding: "utf8" });
  if (result.status !== 0) fail(`git ${gitArgs.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
  return result.stdout.trim();
}

console.log(`
  行き先: ${WORKER_NAME} (${WRANGLER_CONFIG})`);
step("Checking the ref");
const commit = git("rev-parse", "--verify", `${ref}^{commit}`);
const subject = git("log", "-1", "--format=%s", commit);
console.log(`  ${commit.slice(0, 8)}  ${subject}`);

/*
 * `git archive` reads the ref, never the working tree, so uncommitted changes
 * are silently absent from the bundle. That only misleads when the ref was
 * implied: asking for HEAD reads as "deploy what I have". An explicit --ref is
 * already a statement about which commit to ship, and the working tree may
 * legitimately hold unrelated work.
 */
if (refIndex === -1) {
  const dirty = git("status", "--porcelain", "--", "apps/hub");
  if (dirty) {
    console.error("\n  Uncommitted changes under apps/hub, which would not be deployed:");
    for (const line of dirty.split("\n")) console.error(`    ${line}`);
    fail("Commit them, or name the commit you mean with --ref.");
  }
}

const node = wsl("command -v node || true", { capture: true });
const nodePlatform = wsl("node -p process.platform || true", { capture: true }).stdout;
if (!node.stdout || node.stdout.startsWith("/mnt/") || nodePlatform !== "linux") {
  fail(`No Linux node found in ${DISTRO}. Install one (nvm install 22) before deploying.`);
}
console.log(`  node: ${wsl("node -v", { capture: true }).stdout} (${node.stdout})`);

step("Cloning the tree into WSL");
/*
 * A shallow clone rather than `git archive`: parts of the suite shell out to
 * `git rev-parse HEAD`, so an exported tree with no .git fails the tests for a
 * reason that has nothing to do with the change being deployed. Cloning also
 * checks out through Linux git, which leaves the line endings alone instead of
 * carrying the Windows working copy's CRLF.
 */
const branch = refIndex === -1 ? git("rev-parse", "--abbrev-ref", "HEAD") : ref;
if (branch === "HEAD") {
  fail("The repository is in a detached HEAD. Name a branch or tag with --ref.");
}
// WSL git cannot follow a Windows git worktree's `.git` file, so a run from a worktree may name the main checkout
// (same object store) to fetch from.
const fetchRoot = process.env.HUB_STAGING_FETCH_ROOT ? resolve(process.env.HUB_STAGING_FETCH_ROOT) : workspaceRoot;
const posixWorkspace = wsl(`wslpath -a '${fetchRoot}'`, { capture: true }).stdout;
/*
 * One build directory, and more than one session can reach it. Two runs at
 * once do not queue: they clear and refill the same tree, and each one sees
 * the other's damage as its own. That has cost real time — an empty tree read
 * as a bad clone, a half-copied node_modules read as a missing dependency in
 * someone else's package, and a deploy killed mid `npm ci` by a rm that
 * believed it was clearing leftovers.
 *
 * So take the directory before touching it, and say who holds it. A stale
 * lock is one whose process is gone; anything else is a live run and this one
 * waits its turn rather than helping.
 */
const LOCK = `${REMOTE_ROOT}/in-use`;

function takeTheBuildDirectory() {
  const held = wsl(`mkdir -p ${REMOTE_ROOT} && cat ${LOCK} 2>/dev/null || true`, { capture: true }).stdout;
  if (held) {
    const [pid, since] = held.split(" ");
    const alive = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `(Get-Process -Id ${Number(pid) || 0} -ErrorAction SilentlyContinue | Measure-Object).Count`],
      { encoding: "utf8" },
    ).stdout?.trim();
    if (alive && alive !== "0") {
      fail(
        `Another deploy holds ${REMOTE_ROOT} (pid ${pid}, since ${since}).` +
        " Wait for it, or stop it — do not clear the directory by hand while it runs.",
      );
    }
    console.log(`  Taking over from pid ${pid}, which is gone`);
  }
  wsl(`printf '%s %s' ${process.pid} '${new Date().toISOString()}' > ${LOCK}`);
  const release = () => { wsl(`rm -f ${LOCK}`); };
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => { release(); process.exit(1); });
  }
}

takeTheBuildDirectory();

/*
 * Shared WSL memory rules (owner-approved 2026-10-25, shared memory 現行方針): WSL is capped at 6 GB and also runs
 * the AIL agent queue. Before heavy work, require 2.5 GB available and hold ~/agents/heavy.lock so the queue starts no
 * new workers; release it when this script exits, whatever the outcome. A build that once grew to 4.7 GB was
 * OOM-killed and took the queue's loops with it.
 */
function holdHeavyLock() {
  const available = Number(wsl(`awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo`, { capture: true }).stdout);
  if (!Number.isFinite(available) || available < 2560) {
    fail(`WSL has ${available} MB available; staging needs at least 2560 MB. Try again when the agent queue is quieter.`);
  }
  console.log(`  ${available} MB available in WSL`);
  const heavyLock = "~/agents/heavy.lock";
  wsl(`mkdir -p ~/agents && printf 'Hub %s staging %s\\n' '${new Date().toISOString()}' '${ref}' > ${heavyLock}`);
  const release = () => { wsl(`rm -f ${heavyLock}`); };
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => { release(); process.exit(1); });
  }
}

holdHeavyLock();

/*
 * Clearing the workspace is checked, because when it fails the `&&` chain
 * simply stops and everything after reports something else. A leftover
 * node_modules once survived the rm; git init never ran, and the run died
 * claiming the commit did not exist — which sent the search to the wrong
 * place twice before the first line of the log was read.
 */
if (wsl(`rm -rf ${REMOTE_ROOT}/tree`) !== 0) {
  fail(`Could not clear ${REMOTE_ROOT}/tree. Check that no other deploy is running, then remove it by hand.`);
}
wsl(`mkdir -p ${REMOTE_ROOT}/tree && git -C ${REMOTE_ROOT}/tree init -q`);
/*
 * A commit id is the safer thing to name, but a plain fetch only serves refs:
 * `--ref 57cfe497` died with `couldn't find remote ref`, ten seconds in,
 * after the script had already resolved that same id locally and printed its
 * subject. Asking upload-pack to serve reachable objects makes the id work,
 * and it is passed per-invocation so no configuration is left behind in the
 * repository being read.
 */
const uploadPack = `--upload-pack='git -c uploadpack.allowReachableSHA1InWant=true upload-pack'`;
const fetchOne = (wanted, extra = '') =>
  wsl(`cd ${REMOTE_ROOT}/tree && git fetch -q --depth 1 ${extra} 'file://${posixWorkspace}' '${wanted}' && git checkout -q FETCH_HEAD`);
if (fetchOne(branch) !== 0 && fetchOne(commit, uploadPack) !== 0) {
  fail(`Could not fetch '${branch}'. Pass a branch, tag, or commit that exists in the repository.`);
}
const clonedCommit = wsl(`git -C ${REMOTE_ROOT}/tree rev-parse HEAD`, { capture: true }).stdout;
if (clonedCommit !== commit) {
  fail(`The clone landed on ${clonedCommit.slice(0, 8)} but '${ref}' resolves to ${commit.slice(0, 8)}.`);
}
console.log(`  ${wsl(`git -C ${REMOTE_ROOT}/tree ls-files | wc -l`, { capture: true }).stdout} files at ${commit.slice(0, 8)}`);

step("Installing dependencies");
/*
 * npm ci wipes node_modules, so it is reserved for an actual lockfile change.
 * The install is kept beside the tree and moved in, which is also what makes
 * the workspace-level apps/hub/node_modules exist — copying only the root one
 * by hand is what broke an earlier build.
 */
const lockHash = createHash("sha256")
  .update(readFileSync(resolve(workspaceRoot, "package-lock.json")))
  .digest("hex")
  .slice(0, 16);
const stamp = `${REMOTE_ROOT}/node_modules.${lockHash}`;
/*
 * A cached install is only trusted if it still carries a compiler. Two
 * deploys once ran at the same time, and the second one`s rm -rf raced the
 * first one`s copy; the stamp survived while its contents did not, so every
 * later run copied in a node_modules with no tsc and failed type checking
 * ten minutes deep. Checking one binary is cheaper than that.
 */
const cacheUsable = wsl(`test -d ${stamp} && test -x ${stamp}/root/.bin/tsc`) === 0;
if (cacheUsable) {
  console.log("  Reusing the install for this lockfile");
  wsl(`cp -r ${stamp}/root ${REMOTE_ROOT}/tree/node_modules; cp -r ${stamp}/hub ${REMOTE_ROOT}/tree/apps/hub/node_modules`);
  /*
   * The copy is checked, not just the cache it came from. A run once landed
   * an empty node_modules — 623 packages in the cache, nothing in the tree —
   * and the existing check passed because it looks at the cache. Ten minutes
   * later type checking failed on a missing @babylonjs, which reads as a
   * dependency problem in someone else's package and is not one.
   */
  if (wsl(`test -x ${REMOTE_ROOT}/tree/node_modules/.bin/tsc`) !== 0) {
    console.log("  The copy did not land; installing again");
    wsl(`rm -rf ${REMOTE_ROOT}/node_modules.*`);
    fail("The cached install could not be copied into the tree. Re-run; the cache has been cleared.");
  }
} else {
  if (wsl(`test -d ${stamp}`) === 0) console.log("  The cached install is incomplete; installing again");
  /*
   * npm ci's exit code was ignored, so a failed install still stamped the
   * cache and the run carried on to type checking with no compiler — the
   * error surfaced ten minutes later as a type failure, pointing at the
   * wrong thing twice.
   */
  /* Logged like the gates: npm prints its usage text on a lockfile that is
     out of sync, and the reason sits far above it. */
  const installLog = `${REMOTE_ROOT}/last-gate.log`;
  if (wsl(`set -o pipefail; cd ${REMOTE_ROOT}/tree && npm ci --no-audit --no-fund 2>&1 | tee ${installLog}`) !== 0) {
    console.error(`
Last 40 lines of the install:`);
    wsl(`tail -n 40 ${installLog} || true`);
    fail("Installing dependencies failed. Nothing was deployed.");
  }
  wsl(`rm -rf ${REMOTE_ROOT}/node_modules.* && mkdir -p ${stamp} && cp -r ${REMOTE_ROOT}/tree/node_modules ${stamp}/root && cp -r ${REMOTE_ROOT}/tree/apps/hub/node_modules ${stamp}/hub`);
}

/*
 * Shared rule (2026-10-25): heavy work runs on Windows where possible. Type checking needs more than the 2560 MB a
 * WSL process may take (it hit the heap limit there), so type checking and tests run on Windows against this same
 * checkout, which must be exactly the commit being deployed with no local edits under apps/hub. Only the Cloudflare
 * build, which needs Linux, stays in WSL.
 */
function windowsGate(title, command, env = {}) {
  step(`${title} (Windows)`);
  const result = spawnSync(command, { cwd: workspaceRoot, shell: true, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) fail(`${title} failed. Nothing was deployed.`);
}
const localHead = spawnSync("git", ["-C", workspaceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
const localEdits = spawnSync("git", ["-C", workspaceRoot, "status", "--porcelain", "--", "apps/hub", "package.json", "package-lock.json"], { encoding: "utf8" }).stdout.trim();
if (localHead !== commit || localEdits) {
  fail(`Type checking and tests run on Windows in ${workspaceRoot}, which must be at ${commit.slice(0, 8)} with no edits under apps/hub (it is at ${localHead.slice(0, 8)}${localEdits ? ", with edits" : ""}).`);
}
windowsGate("Type checking", "npm run typecheck:hub");
windowsGate("Running tests", "npm run test:hub", { HUB_TEST_REPORTER: "dot" });

const gates = [
  [
    "Building the Cloudflare bundle",
    // WSL is capped at 6 GB with 2 GB swap and also runs the shared agent queue. A 6 GB heap let next-build grow to
    // ~4.7 GB and the kernel OOM-killed it, taking other WSL processes with it (2026-10-25). Cap the heap and use one
    // build worker so a shortage fails this build with a heap error instead.
    // Owner-approved exception to the 2560 MB rule (2026-10-25): the build needs ~4.5 GB and cannot run on Windows.
    // It runs only with heavy.lock held and at least 5 GB available (checked just before this step).
    `HUB_WRANGLER_CONFIG=${WRANGLER_CONFIG} HUB_BUILD_CPUS=1 NODE_OPTIONS=--max-old-space-size=4608 npm run build:hub:cloudflare`,
  ],
];
/*
 * Each gate keeps its own log. Run in the background, the inherited stdio
 * did not always reach the caller, and a failing test gate reported only
 * `npm error command failed` — twice that meant re-running the suite by hand
 * to find out what broke, and once it never reproduced at all.
 */
for (const [title, command] of gates) {
  step(title);
  if (title === "Building the Cloudflare bundle") {
    // heavy.lock stops new agent workers but not the ones already running, so wait (up to 40 min) for them to finish.
    const readFree = () => Number(wsl(`awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo`, { capture: true }).stdout);
    let free = readFree();
    for (let waited = 0; Number.isFinite(free) && free < 5120 && waited < 40; waited += 1) {
      if (waited === 0) console.log(`  ${free} MB available; waiting for running agent workers to finish (heavy.lock blocks new ones)`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
      free = readFree();
    }
    if (!Number.isFinite(free) || free < 5120) {
      fail(`WSL has ${free} MB available; the build needs at least 5120 MB. Try again when the agent queue is quieter.`);
    }
    console.log(`  ${free} MB available for the build`);
  }
  const log = `${REMOTE_ROOT}/last-gate.log`;
  /* pipefail, so tee cannot turn a failing gate into a passing pipeline. */
  if (wsl(`set -o pipefail; cd ${REMOTE_ROOT}/tree && ${command} 2>&1 | tee ${log}`) !== 0) {
    console.error(`
Last 40 lines of ${title}:`);
    wsl(`tail -n 40 ${log} || true`);
    fail(`${title} failed. Nothing was deployed.`);
  }
}

/*
 * wrangler reads its OAuth token from XDG_CONFIG_HOME. Pointing it at the
 * Windows store keeps one set of credentials rather than a second login inside
 * WSL, and this script never reads the token itself.
 */
const wranglerHome = process.env.HUB_DEPLOY_WRANGLER_CONFIG_HOME
  ?? "/mnt/c/Users/" + (process.env.USERNAME ?? "") + "/AppData/Roaming/xdg.config";
const wranglerEnv = `XDG_CONFIG_HOME='${wranglerHome}'`;

step("Dry run");
/*
 * The gates keep a log; this step did not, and a dry run that failed once
 * left the same bare line the test gate used to. Rerunning the identical
 * command by hand succeeded, so whatever went wrong was momentary — and
 * unknowable without the output.
 */
const dryRunLog = `${REMOTE_ROOT}/last-gate.log`;
/*
 * The dry run also writes the bundle that is deployed, so what was checked is
 * what ships. Wrangler bundles once here; the deploy below uploads this file
 * with --no-bundle.
 */
const BUNDLE_DIR = ".wrangler/deploy-bundle";
const BUNDLE_FILE = `${BUNDLE_DIR}/custom-worker.js`;
if (wsl(`set -o pipefail; cd ${REMOTE_ROOT}/tree/apps/hub && rm -rf ${BUNDLE_DIR} && ${wranglerEnv} npx wrangler deploy --dry-run --outdir ${BUNDLE_DIR} --config ${CONFIG_BASENAME} 2>&1 | tee ${dryRunLog}`) !== 0) {
  console.error(`
Last 40 lines of the dry run:`);
  wsl(`tail -n 40 ${dryRunLog} || true`);
  fail("The dry run failed. Nothing was deployed.");
}

step("Making the bundle ASCII");
/*
 * V8 keeps a script's source as UTF-16 once it holds one non-Latin-1
 * character. The ~53 MB bundle carried ~30 000 such bytes (Japanese regex
 * literals, legal comments), so its source alone took ~106 MB of the 128 MB
 * isolate limit. Over the limit, Workers replaces the isolate after every
 * request, and every request paid a 2-4 s cold start (staging, 2026-10-14).
 * Escaping those characters halves the source's heap; the check fails the
 * run if any remain.
 */
if (wsl(`set -o pipefail; cd ${REMOTE_ROOT}/tree/apps/hub && node scripts/ascii-worker-bundle.mjs ${BUNDLE_FILE} && node scripts/ascii-worker-bundle.mjs --check ${BUNDLE_FILE} 2>&1 | tee ${dryRunLog}`) !== 0) {
  fail("The bundle still contains non-ASCII characters. Nothing was deployed.");
}

step("Marking the handler for eager compilation");
/*
 * The 45 MiB OpenNext handler sits in one lazy `__esm(async () => {...})`
 * wrapper. V8 compiles a lazy arrow function twice (pre-parse at isolate
 * start, full parse on the first request). Rewriting it to a parenthesised
 * `(async function () {...})` makes V8 compile it once. Measured in workerd:
 * spawn to first response 2.9 s -> 1.6 s, with unchanged time to listen
 * (docs/hub-worker-size/MEASURE.md, section 7). The same file is checked
 * afterwards, so a change in the bundle's shape stops the run instead of
 * silently losing the gain.
 */
if (wsl(`set -o pipefail; cd ${REMOTE_ROOT}/tree/apps/hub && node scripts/eager-handler-bundle.mjs ${BUNDLE_FILE} && node scripts/eager-handler-bundle.mjs --check ${BUNDLE_FILE} 2>&1 | tee ${dryRunLog}`) !== 0) {
  fail("The handler wrapper could not be marked for eager compilation. Nothing was deployed.");
}

if (!shouldDeploy) {
  console.log(`\n[1mEvery gate passed.[0m Nothing was deployed.`);
  console.log(`Re-run with --deploy to publish ${commit.slice(0, 8)} to ${WORKER_NAME}.\n`);
  process.exit(0);
}

step(`Deploying to ${WORKER_NAME}`);
/*
 * The last step without a log. Everything before it kept one, so a failure
 * here was the only one that still said nothing but that it happened.
 */
const deployLog = `${REMOTE_ROOT}/last-gate.log`;
if (wsl(`set -o pipefail; cd ${REMOTE_ROOT}/tree/apps/hub && ${wranglerEnv} npx wrangler deploy ${BUNDLE_FILE} --no-bundle --config ${CONFIG_BASENAME} 2>&1 | tee ${deployLog}`) !== 0) {
  console.error(`
Last 40 lines of the deployment:`);
  wsl(`tail -n 40 ${deployLog} || true`);
  fail("The deployment failed.");
}
console.log(`\n[1mDeployed ${commit.slice(0, 8)}.[0m Verify the running Worker before moving on.\n`);
