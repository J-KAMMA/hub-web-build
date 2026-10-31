import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Every Hub test run gets one parent temp folder, and TEMP/TMP/TMPDIR point at it so that each
 * mkdtemp(os.tmpdir()) inside workers and spawned processes lands there. The main process removes it
 * after the run. Per-file `process.once("exit")` cleanup never ran: vitest terminates its workers, and
 * on Windows the still-open SQLite copies blocked the delete. By 2026-10-17 about 2,200 folders
 * (~65 GB) had piled up in %TEMP%.
 */
export default function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), "hub-test-run-"));
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = root;
  process.env.TMP = root;
  process.env.TMPDIR = root;
  return () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
}
