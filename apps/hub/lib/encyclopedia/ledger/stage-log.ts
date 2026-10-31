import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/*
 * Per-stage wall-time log for the ledger scripts: one JSON line per stage run, appended to the file named by
 * HUBPEDIA_LEDGER_STAGE_LOG (or setStageLog). With no file configured, timed() only calls the function.
 * Lines hold stage names, durations and small counters; never prompt text, claims or credentials.
 */

let target: string | null | undefined;

export function setStageLog(path: string | null) {
  target = path;
  if (path) mkdirSync(dirname(path), { recursive: true });
}

const logPath = () => (target !== undefined ? target : process.env.HUBPEDIA_LEDGER_STAGE_LOG || null);

export function logStage(stage: string, ms: number, meta: Record<string, string | number | boolean | null> = {}) {
  const path = logPath();
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ at: Date.now(), stage, ms: Math.round(ms * 100) / 100, ...meta })}\n`, "utf8");
  } catch { /* logging never breaks a run */ }
}

export async function timed<T>(stage: string, work: () => Promise<T>, meta: Record<string, string | number | boolean | null> = {}): Promise<T> {
  if (!logPath()) return work();
  const started = performance.now();
  let ok = true;
  try {
    return await work();
  } catch (error) {
    ok = false;
    throw error;
  } finally {
    logStage(stage, performance.now() - started, { ...meta, ...(ok ? {} : { threw: true }) });
  }
}

/** Wraps a model call function so every call is logged as stage "model" with the call's own stage name. */
export function timedModel<A extends unknown[], R>(call: (...args: A) => Promise<R>, stageOf: (...args: A) => string): (...args: A) => Promise<R> {
  return (...args) => timed("model", () => call(...args), { callStage: stageOf(...args) });
}
