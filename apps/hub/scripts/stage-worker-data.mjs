import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Copies the Worker's read-only data files (lib/server/worker-data-files.json)
 * into the static assets directory, where lib/server/worker-data.ts reads them
 * through the ASSETS binding. They are not imported as modules any more, so the
 * Worker script no longer carries them. Runs after the OpenNext build, which
 * recreates .open-next/assets.
 *
 * Each file is parsed first, so a truncated or conflict-marked file fails the
 * build here and not on the first request.
 */

const hubRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(hubRoot, "lib/server/worker-data-files.json"), "utf8"));

export function stageWorkerData(assetsDirectory = join(hubRoot, ".open-next/assets")) {
  if (!existsSync(assetsDirectory)) {
    throw new Error(`Assets directory ${assetsDirectory} does not exist; run the OpenNext build first.`);
  }
  const target = join(assetsDirectory, manifest.prefix);
  mkdirSync(target, { recursive: true });
  const staged = [];
  for (const [name, relative] of Object.entries(manifest.files)) {
    const text = readFileSync(join(hubRoot, relative), "utf8");
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object") throw new Error(`${relative} is not a JSON object or array.`);
    /* Re-serialised without whitespace: the source files are already compact, this only guarantees it. */
    const body = JSON.stringify(value);
    writeFileSync(join(target, `${name}.json`), body);
    staged.push({ name, bytes: Buffer.byteLength(body) });
  }
  return staged;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const item of stageWorkerData()) console.log(`staged ${manifest.prefix}${item.name}.json (${item.bytes} bytes)`);
}
