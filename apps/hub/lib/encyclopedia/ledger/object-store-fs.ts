import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import type { LedgerObjectStore } from "./object-store";

/** Filesystem store for local and throwaway runs (`--objects=<dir>`). Keys map to paths under the directory. */
export function fsObjectStore(directory: string): LedgerObjectStore {
  const root = resolve(directory);
  if (/[\\/]\.wrangler([\\/]|$)/iu.test(root)) throw new Error("--objects must not point into a .wrangler directory.");
  const pathOf = (key: string) => {
    const file = resolve(root, ...key.split("/"));
    if (!file.startsWith(root + sep)) throw new Error(`Object key escapes the store: ${key}`);
    return file;
  };
  const made = new Set<string>();
  return {
    async has(key) { return existsSync(pathOf(key)); },
    async get(key) { const file = pathOf(key); return existsSync(file) ? readFileSync(file, "utf8") : null; },
    async put(key, body) {
      const file = pathOf(key);
      const folder = dirname(file);
      if (!made.has(folder)) { mkdirSync(folder, { recursive: true }); made.add(folder); }
      const temp = join(folder, `.${process.pid}.${Date.now()}.tmp`);
      writeFileSync(temp, body, "utf8");
      renameSync(temp, file);
    },
  };
}
