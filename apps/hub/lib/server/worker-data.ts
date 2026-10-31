import filesManifest from "./worker-data-files.json";

/*
 * Large read-only JSON (the Hubpedia seed and claim graph, the four novels)
 * used to be imported as modules, so every byte of it sat in the Worker script:
 * about 9 MB of retained source on every route, twice for the seed. It is now
 * a static asset under `${prefix}`, copied into the assets directory at build
 * time by scripts/stage-worker-data.mjs, and read through the ASSETS binding on
 * first use per isolate.
 *
 * The prefix is listed in `assets.run_worker_first`, so a browser asking for it
 * reaches the Worker, which answers 404 (custom-worker.ts); only the binding can
 * read the files. Nothing here is a public download.
 *
 * Outside Workers (next dev, vitest, scripts) the same file is read from disk.
 * Inside Workers every failure throws: a page must not render with an empty
 * catalogue because an asset fetch failed.
 */

export const WORKER_DATA_PREFIX: string = filesManifest.prefix;

export type WorkerDataName = keyof typeof filesManifest.files;

export type WorkerDataEnv = { ASSETS?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> } };

export class WorkerDataUnavailableError extends Error {
  constructor(name: string, reason: string) {
    super(`Worker data "${name}" is unavailable: ${reason}`);
    this.name = "WorkerDataUnavailableError";
  }
}

const loaded = new Map<string, Promise<unknown>>();

function inWorkers() {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

async function assetsBinding(explicit?: WorkerDataEnv | null) {
  if (explicit?.ASSETS) return explicit.ASSETS;
  if (!inWorkers()) return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const binding = Reflect.get(getCloudflareContext().env as object, "ASSETS");
    return binding && typeof Reflect.get(binding, "fetch") === "function" ? (binding as NonNullable<WorkerDataEnv["ASSETS"]>) : null;
  } catch {
    /* No request context (a queue or cron invocation that did not pass env): treated as no binding, which fails closed below. */
    return null;
  }
}

async function readFromDisk(name: WorkerDataName): Promise<unknown> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const relative = filesManifest.files[name];
  const roots = [process.cwd(), join(process.cwd(), "apps", "hub")];
  let lastError: unknown;
  for (const root of roots) {
    try {
      return JSON.parse(await readFile(join(root, relative), "utf8"));
    } catch (error) {
      lastError = error;
    }
  }
  throw new WorkerDataUnavailableError(name, `cannot read ${relative} (${lastError instanceof Error ? lastError.message : "unknown error"})`);
}

async function readFromAssets(name: WorkerDataName, assets: NonNullable<WorkerDataEnv["ASSETS"]>): Promise<unknown> {
  let response: Response;
  try {
    response = await assets.fetch(new Request(`https://assets.invalid${WORKER_DATA_PREFIX}${name}.json`));
  } catch (error) {
    throw new WorkerDataUnavailableError(name, `asset fetch failed (${error instanceof Error ? error.message : "unknown error"})`);
  }
  if (!response.ok) throw new WorkerDataUnavailableError(name, `asset fetch returned ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new WorkerDataUnavailableError(name, "asset is not valid JSON");
  }
}

/**
 * Loads one data file once per isolate. A failed load is not cached, so the
 * next request retries instead of serving the failure until the isolate dies.
 * `validate` rejects data whose shape is wrong; its exception propagates.
 */
export function loadWorkerData<T>(name: WorkerDataName, validate: (value: unknown) => T, env?: WorkerDataEnv | null): Promise<T> {
  const cached = loaded.get(name);
  if (cached) return cached as Promise<T>;
  const pending = (async () => {
    const assets = await assetsBinding(env);
    if (!assets && inWorkers()) throw new WorkerDataUnavailableError(name, "ASSETS binding is not configured");
    const raw = assets ? await readFromAssets(name, assets) : await readFromDisk(name);
    return validate(raw);
  })();
  loaded.set(name, pending);
  pending.catch(() => {
    if (loaded.get(name) === pending) loaded.delete(name);
  });
  return pending;
}

/** Test seam: forget what this isolate has loaded. */
export function resetWorkerDataCache() {
  loaded.clear();
}
