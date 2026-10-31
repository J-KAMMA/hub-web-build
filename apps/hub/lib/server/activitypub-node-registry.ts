import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { discoverActivityPub, parseActivityPubQuery } from "@/lib/server/activitypub-discovery";
import { getActivityPubPublicSources } from "@/lib/server/activitypub-source-config";

const BATCH_SIZE = 4;
const MAX_DISCOVERED_PER_NODE = 12;

function hostFromTarget(target: string): string | null {
  try {
    const parsed = parseActivityPubQuery(target);
    return parsed.kind === "acct" ? parsed.host : new URL(parsed.url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function nextCheck(now: Date, hours: number) {
  return new Date(now.getTime() + hours * 60 * 60 * 1_000).toISOString();
}

export async function seedActivityPubNodeRegistry(database: D1Database, now = new Date()) {
  const timestamp = now.toISOString();
  const seeds = getActivityPubPublicSources();
  const statements = seeds.flatMap((target) => {
    const host = hostFromTarget(target);
    return host ? [database.prepare(
      `INSERT INTO activitypub_nodes
         (host, discovery_target, status, source_type, discovered_from, first_seen_at, next_check_at)
       VALUES (?, ?, 'discovered', 'seed', NULL, ?, ?)
       ON CONFLICT(host) DO UPDATE SET
         discovery_target = CASE WHEN activitypub_nodes.status = 'excluded' THEN activitypub_nodes.discovery_target ELSE excluded.discovery_target END,
         source_type = CASE WHEN activitypub_nodes.source_type = 'operator' THEN 'operator' ELSE 'seed' END`,
    ).bind(host, target, timestamp, timestamp)] : [];
  });
  if (statements.length) await database.batch(statements);
  return statements.length;
}

export async function listActivityPubRegistrySources(database: D1Database, limit = 8) {
  const result = await database.prepare(
    `SELECT discovery_target AS discoveryTarget
     FROM activitypub_nodes
     WHERE status = 'verified'
     ORDER BY COALESCE(last_success_at, first_seen_at) DESC
     LIMIT ?`,
  ).bind(Math.max(1, Math.min(24, limit))).all<{ discoveryTarget: string }>();
  return result.results.map((row) => row.discoveryTarget);
}

export async function refreshActivityPubNodeRegistry(
  database: D1Database,
  fetcher: typeof fetch = fetch,
  now = new Date(),
) {
  await seedActivityPubNodeRegistry(database, now);
  const due = await database.prepare(
    `SELECT host, discovery_target AS discoveryTarget, failure_count AS failureCount
     FROM activitypub_nodes
     WHERE status IN ('discovered','verified','limited') AND next_check_at <= ?
     ORDER BY CASE status WHEN 'discovered' THEN 0 WHEN 'limited' THEN 1 ELSE 2 END,
              next_check_at ASC
     LIMIT ?`,
  ).bind(now.toISOString(), BATCH_SIZE).all<{
    host: string;
    discoveryTarget: string;
    failureCount: number;
  }>();

  let verified = 0;
  let discovered = 0;
  let limited = 0;
  for (const node of due.results) {
    await database.prepare("UPDATE activitypub_nodes SET status = 'fetching', last_checked_at = ? WHERE host = ?")
      .bind(now.toISOString(), node.host).run();
    try {
      const result = await discoverActivityPub(node.discoveryTarget, fetcher);
      await database.prepare(
        `UPDATE activitypub_nodes SET status = 'verified', failure_count = 0,
           last_error_code = NULL, last_success_at = ?, next_check_at = ? WHERE host = ?`,
      ).bind(now.toISOString(), nextCheck(now, 24), node.host).run();
      verified += 1;

      const candidates = result.discoveredTargets.slice(0, MAX_DISCOVERED_PER_NODE);
      const statements = candidates.flatMap((target) => {
        const host = hostFromTarget(target);
        if (!host || host === node.host) return [];
        return [database.prepare(
          `INSERT INTO activitypub_nodes
             (host, discovery_target, status, source_type, discovered_from, first_seen_at, next_check_at)
           VALUES (?, ?, 'discovered', 'federation', ?, ?, ?)
           ON CONFLICT(host) DO NOTHING`,
        ).bind(host, target, node.host, now.toISOString(), now.toISOString())];
      });
      if (statements.length) {
        const results = await database.batch(statements);
        discovered += results.reduce((total, value) => total + Number(value.meta.changes ?? 0), 0);
      }
    } catch (error) {
      const failures = node.failureCount + 1;
      const status = failures >= 5 ? "limited" : "discovered";
      const delayHours = Math.min(24 * 7, 2 ** Math.min(failures, 7));
      const code = error instanceof Error ? error.message.slice(0, 64) : "unavailable";
      await database.prepare(
        `UPDATE activitypub_nodes SET status = ?, failure_count = ?, last_error_code = ?, next_check_at = ? WHERE host = ?`,
      ).bind(status, failures, code, nextCheck(now, delayHours), node.host).run();
      limited += 1;
    }
  }
  return { processed: due.results.length, verified, discovered, limited };
}
