import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { D1Database } from "@cloudflare/workers-types";

import { fsObjectStore } from "../lib/encyclopedia/ledger/object-store-fs";
import { r2ObjectStore, type LedgerObjectStore, type R2BucketLike } from "../lib/encyclopedia/ledger/object-store";

/*
 * Local access to the Hub's development D1 for the Hubpedia hub-topic scripts.
 *
 * The database is reached through wrangler's own platform proxy, which opens
 * the same local Wrangler D1 state the dev server uses (apps/hub/.wrangler/
 * state/v3). The SQLite files are never opened directly. This helper only
 * ever targets wrangler.dev.jsonc; production and staging resources are not
 * reachable from it.
 *
 * The lib/server modules import "server-only", a build-time marker with no runtime
 * content and no package installed for plain Node. The script re-executes itself
 * once with scripts/server-only-stub.cjs preloaded to satisfy it.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const hubDir = resolve(scriptDir, "..");
const stub = resolve(scriptDir, "server-only-stub.cjs");

/** Re-run the current script with the server-only stub preloaded. Call first; exit if it returns true. */
export function reexecWithServerOnlyStub(): boolean {
  if (process.env.HUBPEDIA_REACT_SERVER === "1") return false;
  const result = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      HUBPEDIA_REACT_SERVER: "1",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(stub)}`.trim(),
    },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  return true;
}

export async function openLocalHubDatabase(): Promise<{ db: D1Database; objects: LedgerObjectStore; dispose: () => Promise<void> }> {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ HUB_DATABASE: D1Database; HUB_LEDGER_SOURCES: R2BucketLike }>({
    configPath: resolve(hubDir, "wrangler.dev.jsonc"),
  });
  return { db: proxy.env.HUB_DATABASE, objects: r2ObjectStore(proxy.env.HUB_LEDGER_SOURCES), dispose: () => proxy.dispose() };
}

/**
 * `--objects=<dir>` (or HUBPEDIA_LEDGER_OBJECTS) names a directory used as the ledger object store instead of the
 * Wrangler R2 state. With `--sqlite=<file>` and no `--objects`, the store defaults to `<file>.objects/`.
 */
export function objectsDirectory(argv: readonly string[] = process.argv): string | null {
  const flag = argv.find((argument) => argument.startsWith("--objects="))?.slice("--objects=".length);
  const value = flag || process.env.HUBPEDIA_LEDGER_OBJECTS || "";
  if (value) return resolve(value);
  const sqlite = throwawaySqlitePath(argv);
  return sqlite ? `${sqlite}.objects` : null;
}

/**
 * `--sqlite=<file>` (or HUBPEDIA_LEDGER_SQLITE) names a throwaway SQLite file instead of the Wrangler D1.
 * The file is created with every migration applied when it does not exist. It is the only database that
 * ledger scripts may write to while the owner's no-D1-writes rule stands. Paths inside a .wrangler
 * directory are refused so this can never open the Wrangler state.
 */
export function throwawaySqlitePath(argv: readonly string[] = process.argv): string | null {
  const flag = argv.find((argument) => argument.startsWith("--sqlite="))?.slice("--sqlite=".length);
  const value = flag || process.env.HUBPEDIA_LEDGER_SQLITE || "";
  if (!value) return null;
  const file = resolve(value);
  if (/[\/]\.wrangler[\/]/iu.test(file) || /\.wrangler$/iu.test(file)) throw new Error("--sqlite must not point into a .wrangler directory.");
  return file;
}

/** The Wrangler D1 normally; the throwaway SQLite file when --sqlite is given. */
export async function openHubDatabase(): Promise<{ db: D1Database; objects: LedgerObjectStore; dispose: () => Promise<void>; throwaway: boolean }> {
  const file = throwawaySqlitePath();
  const directory = objectsDirectory();
  if (!file) {
    const local = await openLocalHubDatabase();
    return { ...local, objects: directory ? fsObjectStore(directory) : local.objects, throwaway: false };
  }
  const { existsSync, mkdirSync } = await import("node:fs");
  const { DatabaseSync } = await import("node:sqlite");
  const { buildTemplateDatabase, wrapSqliteAsD1 } = await import("../lib/testing/sqlite-d1");
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) buildTemplateDatabase(hubDir, file);
  const sql = new DatabaseSync(file);
  return { db: wrapSqliteAsD1(sql).db, objects: fsObjectStore(directory ?? `${file}.objects`), dispose: async () => { sql.close(); }, throwaway: true };
}
