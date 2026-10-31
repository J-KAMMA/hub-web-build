import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const hubDirectory = path.resolve(scriptDirectory, "..");
const platformDirectory = path.resolve(hubDirectory, "..", "..");
const nextBin = path.join(platformDirectory, "node_modules", "next", "dist", "bin", "next");
const distDirectoryName = process.env.NEXT_DIST_DIR || ".next-hubpedia-3000";
const buildId = path.join(hubDirectory, distDirectoryName, "BUILD_ID");
const pidFile = path.join(hubDirectory, "hubpedia-watchdog-3000.pid");
const outputLog = path.join(hubDirectory, "hubpedia-server-3000.out.log");
const errorLog = path.join(hubDirectory, "hubpedia-server-3000.err.log");
const healthUrl = "http://127.0.0.1:3000/api/health";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function isHealthy() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

if (process.argv.includes("--check")) {
  const healthy = await isHealthy();
  console.log(healthy ? `Hubpedia is healthy: ${healthUrl}` : `Hubpedia is unavailable: ${healthUrl}`);
  process.exitCode = healthy ? 0 : 1;
} else {
  if (existsSync(pidFile)) {
    const existingPid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
    try {
      if (existingPid > 0) process.kill(existingPid, 0);
      console.log(`Hubpedia watchdog is already running (PID ${existingPid}).`);
      process.exit(0);
    } catch {
      // Stale PID files are replaced below.
    }
  }

  writeFileSync(pidFile, String(process.pid), "utf8");
  const cleanup = () => {
    try { unlinkSync(pidFile); } catch {}
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => process.exit(0));
  process.once("SIGTERM", () => process.exit(0));

  while (true) {
    if (!existsSync(buildId)) {
      console.error("Hubpedia production build is missing. Run npm run build:hub first.");
      await delay(30000);
      continue;
    }
    if (await isHealthy()) {
      await delay(10000);
      continue;
    }

    const output = openSync(outputLog, "a");
    const error = openSync(errorLog, "a");
    const child = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", "3000"], {
      cwd: hubDirectory,
      env: { ...process.env, NEXT_DIST_DIR: distDirectoryName },
      windowsHide: true,
      stdio: ["ignore", output, error],
    });

    let failedChecks = 0;
    while (child.exitCode === null && child.signalCode === null) {
      await delay(10000);
      if (await isHealthy()) failedChecks = 0;
      else failedChecks += 1;
      if (failedChecks >= 3) {
        child.kill();
        break;
      }
    }
    closeSync(output);
    closeSync(error);
    await delay(3000);
  }
}
