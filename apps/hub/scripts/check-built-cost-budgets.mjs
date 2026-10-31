import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const hubRoot = resolve(import.meta.dirname, "..");
const chunksRoot = join(hubRoot, ".next", "static", "chunks");
const appBuildManifestPath = join(hubRoot, ".next", "app-build-manifest.json");
if (!existsSync(chunksRoot)) throw new Error("Run the Hub build before checking bundle budgets.");
if (!existsSync(appBuildManifestPath)) throw new Error("The Hub app build manifest is missing.");

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const chunks = filesUnder(chunksRoot).filter((path) => path.endsWith(".js"));
// This ceiling starts just above the reviewed legacy vendor chunk. Tighten it
// as chain SDKs are split; CI still prevents any regression beyond baseline.
const chunkBudgetBytes = 1_250 * 1024;
const oversized = chunks.filter((path) => statSync(path).size > chunkBudgetBytes);
const totalBytes = chunks.reduce((total, path) => total + statSync(path).size, 0);
if (oversized.length) throw new Error(`JavaScript chunk budget exceeded (1,250 KiB):\n${oversized.map((path) => `${relative(hubRoot, path)}: ${statSync(path).size}`).join("\n")}`);
if (totalBytes > 7.5 * 1024 * 1024) throw new Error(`Total JavaScript budget exceeded (7.5 MiB): ${totalBytes} bytes`);

const appBuildManifest = JSON.parse(readFileSync(appBuildManifestPath, "utf8"));
const routeBudgets = new Map([
  ["/community/page", 715 * 1024],
  ["/vault/page", 690 * 1024],
  ["/wallet/page", 630 * 1024],
  ["/ai/page", 735 * 1024],
]);
const routeResults = [];
for (const [route, budget] of routeBudgets) {
  const routeFiles = appBuildManifest.pages?.[route];
  if (!Array.isArray(routeFiles)) throw new Error(`Route is missing from the app build manifest: ${route}`);
  const bytes = routeFiles
    .filter((path) => path.endsWith(".js"))
    .reduce((sum, path) => sum + statSync(join(hubRoot, ".next", path)).size, 0);
  if (bytes > budget) {
    throw new Error(`Initial JavaScript budget exceeded for ${route} (${Math.round(budget / 1024)} KiB): ${bytes} bytes`);
  }
  routeResults.push(`${route} ${Math.round(bytes / 1024)} KiB`);
}

console.log(`Hub bundle budget passed: ${chunks.length} chunks, ${totalBytes} bytes; ${routeResults.join(", ")}.`);
