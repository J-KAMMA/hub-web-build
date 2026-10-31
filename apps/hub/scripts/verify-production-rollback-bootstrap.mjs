import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hubRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(resolve(hubRoot, "wrangler.production-rollback.jsonc"), "utf8");
const worker = readFileSync(resolve(hubRoot, "production-rollback-worker.ts"), "utf8");
const failures = [];

for (const [label, pattern] of [
  ["canonical Worker name", /"name"\s*:\s*"jkamma-hub"/u],
  ["rollback-only entry point", /"main"\s*:\s*"production-rollback-worker\.ts"/u],
  ["workers.dev disabled", /"workers_dev"\s*:\s*false/u],
  ["preview URLs disabled", /"preview_urls"\s*:\s*false/u],
  ["empty routes", /"routes"\s*:\s*\[\s*\]/u],
]) {
  if (!pattern.test(config)) failures.push(`${label}: missing`);
}

for (const forbidden of [
  "d1_databases",
  "r2_buckets",
  "queues",
  "triggers",
  "assets",
  "services",
  "vars",
]) {
  if (new RegExp(`"${forbidden}"\\s*:`, "u").test(config))
    failures.push(`${forbidden}: forbidden in rollback bootstrap config`);
}

if (!/status:\s*503/u.test(worker)) failures.push("rollback Worker must return HTTP 503");
if (!/["']cache-control["']:\s*["']no-store["']/u.test(worker))
  failures.push("rollback Worker must disable caching");
if (/\b(fetch|connect|log|database|queue|bucket)\s*\(/iu.test(worker.replace(/fetch\(\): Response/u, "")))
  failures.push("rollback Worker must not perform I/O");

if (failures.length) {
  console.error(`Hub production rollback bootstrap failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Hub production rollback bootstrap: isolated maintenance Worker verified.");
