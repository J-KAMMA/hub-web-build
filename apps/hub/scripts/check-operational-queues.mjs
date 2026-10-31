import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const hubDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "hub-queue-health-"));
const queryFile = path.join(temporaryRoot, "queues.sql");
const maximumDepth = Number(process.env.HUB_QUEUE_DEPTH_ALERT ?? 500);
const maximumAgeSeconds = Number(process.env.HUB_QUEUE_AGE_ALERT_SECONDS ?? 3600);

const query = `
SELECT 'video_import_jobs' AS queue, COUNT(*) AS depth,
  COALESCE(CAST((julianday('now') - julianday(MIN(created_at))) * 86400 AS INTEGER), 0) AS oldestAgeSeconds
FROM video_import_jobs WHERE status = 'queued'
UNION ALL
SELECT 'hubpedia_repair_queue', COUNT(*),
  COALESCE(CAST((julianday('now') - julianday(MIN(created_at))) * 86400 AS INTEGER), 0)
FROM hubpedia_repair_queue WHERE status = 'queued'
UNION ALL
SELECT 'hubpedia_category_refresh_queue', COUNT(*),
  COALESCE(CAST((julianday('now') - julianday(MIN(requested_at))) * 86400 AS INTEGER), 0)
FROM hubpedia_category_refresh_queue WHERE status = 'queued';
`;

try {
  writeFileSync(queryFile, query, { mode: 0o600 });
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--file", queryFile, "--json"],
    { cwd: hubDirectory, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    console.log(JSON.stringify({ healthy: false, category: "queue_check_unavailable" }));
    process.exitCode = 2;
  } else {
    const payload = JSON.parse(result.stdout);
    const queues = (Array.isArray(payload) ? payload.flatMap((entry) => entry?.results ?? []) : [])
      .map((row) => ({
        queue: String(row.queue),
        depth: Number(row.depth),
        oldestAgeSeconds: Number(row.oldestAgeSeconds),
      }));
    const unhealthy = queues.filter((queue) =>
      queue.depth > maximumDepth ||
      (queue.depth > 0 && queue.oldestAgeSeconds > maximumAgeSeconds)
    );
    console.log(JSON.stringify({
      healthy: unhealthy.length === 0,
      checkedAt: new Date().toISOString(),
      thresholds: { maximumDepth, maximumAgeSeconds },
      queues,
      unhealthy: unhealthy.map((queue) => queue.queue),
    }));
    if (unhealthy.length > 0) process.exitCode = 1;
  }
} catch {
  console.log(JSON.stringify({ healthy: false, category: "queue_check_invalid_response" }));
  process.exitCode = 2;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
