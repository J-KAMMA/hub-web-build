import { join } from "node:path";

/*
 * Cache namespaces for model answers (docs/hubpedia-ledger.md section 1). The cache key is a hash of the request, so
 * the same question gets the same stored answer whoever answered it. That is right inside one run and wrong across
 * providers or trials: answers written by a file provider (a person or an agent pasting results) would otherwise be
 * served later as if the chain had produced them. Each provider gets its own directory under data/ledger/cache, and
 * `--cache-namespace <name>` picks another one explicitly (one per trial).
 */

const NAMESPACE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** "file-<directory name>" when the file provider is on (HUBPEDIA_FILE_PROVIDER_DIR), otherwise "chain". */
export function defaultCacheNamespace(env: Record<string, string | undefined> = process.env): string {
  const directory = env.HUBPEDIA_FILE_PROVIDER_DIR;
  if (!directory) return "chain";
  const name = (directory.split(/[\\/]+/u).filter(Boolean).pop() ?? "").toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^[^a-z0-9]+/u, "").slice(0, 56);
  return `file-${name || "default"}`;
}

export function resolveCacheNamespace(explicit: string | undefined, env: Record<string, string | undefined> = process.env): string {
  if (explicit === undefined) return defaultCacheNamespace(env);
  if (!NAMESPACE.test(explicit)) throw new Error(`--cache-namespace must be 1-64 characters of a-z, 0-9, ".", "_" or "-" (got "${explicit}").`);
  return explicit;
}

/** data/ledger/cache/<namespace>; stages (extract, judge, compose, ...) go below it. */
export const ledgerCacheRoot = (baseCacheDir: string, namespace: string) => join(baseCacheDir, namespace);
