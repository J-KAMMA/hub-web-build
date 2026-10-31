import type { D1Database } from "@cloudflare/workers-types";

/*
 * Retention for values that can single out a person (owner decision 2026-10-18; docs/hub-privacy/AUDIT.md 8.8).
 *
 * - Viewer hashes (random-cookie hashes used to count one view per day) and the Hubpedia IP hash: 90 days.
 * - hub_wallet_user_operations.sender (a wallet address): 1 year after confirmation.
 *
 * Per table we either delete the row or null the column, whichever keeps what the product shows correct:
 * - external_video_views: deleted, after adding the deleted rows to external_videos.archived_view_count
 *   in the same batch, so the lifetime view count does not shrink (the 7-day "rising" count never
 *   looks back 90 days). viewer_hash is part of the primary key and cannot be nulled.
 * - video_playback_events, market_popularity_events: deleted. Nothing reads them back; the hash is
 *   part of their unique key.
 * - hubpedia_wiki_activity_events.client_ip_hash: nulled. The row stays for per-profile limits and
 *   abuse review, which use the profile, not the IP.
 * - hub_wallet_user_operations.sender: nulled. The op -> tx mapping still answers receipts.
 *
 * D1 bills rows read and written. Every query walks an index that leads with the retention time
 * (migration 0271), at most BATCH rows per pass and MAX_PASSES passes per table per run; the rest is
 * taken by the next hourly run. Never OFFSET.
 */
export const PRIVACY_RETENTION_BATCH = 500;
const MAX_PASSES = 4;
const DAY_MS = 86_400_000;
export const VIEWER_HASH_RETENTION_DAYS = 90;
export const WALLET_SENDER_RETENTION_DAYS = 365;

type Result = Record<string, number>;
type Options = { batch?: number; maxPasses?: number };

const isoBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
const dateBefore = (now: Date, days: number) => isoBefore(now, days).slice(0, 10);

/** Statements are fixed here; never built from input. */
const DELETE_RULES = [
  { table: "video_playback_events", sql: "DELETE FROM video_playback_events WHERE rowid IN (SELECT rowid FROM video_playback_events WHERE event_day < ? ORDER BY event_day LIMIT ?)" },
  { table: "market_popularity_events", sql: "DELETE FROM market_popularity_events WHERE rowid IN (SELECT rowid FROM market_popularity_events WHERE event_date < ? ORDER BY event_date LIMIT ?)" },
] as const;
const NULL_RULES = [
  {
    table: "hubpedia_wiki_activity_events",
    sql: "UPDATE hubpedia_wiki_activity_events SET client_ip_hash = NULL WHERE rowid IN (SELECT rowid FROM hubpedia_wiki_activity_events WHERE client_ip_hash IS NOT NULL AND created_at < ? ORDER BY created_at LIMIT ?)",
    days: VIEWER_HASH_RETENTION_DAYS,
  },
  {
    table: "hub_wallet_user_operations",
    sql: "UPDATE hub_wallet_user_operations SET sender = NULL WHERE rowid IN (SELECT rowid FROM hub_wallet_user_operations WHERE sender IS NOT NULL AND submitted_at < ? ORDER BY submitted_at LIMIT ?)",
    days: WALLET_SENDER_RETENTION_DAYS,
  },
] as const;

async function repeat(passes: number, batch: number, step: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    const changes = await step();
    total += changes;
    if (changes < batch) break;
  }
  return total;
}

/** Old video views: count them into archived_view_count, then delete them, atomically per pass. */
async function purgeVideoViews(db: D1Database, cutoffDate: string, batch: number): Promise<number> {
  const rows = await db.prepare(
    "SELECT rowid AS id FROM external_video_views WHERE view_date < ? ORDER BY view_date LIMIT ?",
  ).bind(cutoffDate, batch).all<{ id: number }>();
  const ids = (rows.results ?? []).map((row) => Number(row.id));
  if (!ids.length) return 0;
  const list = JSON.stringify(ids);
  // Counts only rows that still exist inside this transaction, so a concurrent run cannot count a row twice.
  const [, deleted] = await db.batch([
    db.prepare(`UPDATE external_videos SET archived_view_count = archived_view_count + c.n
      FROM (SELECT v.video_id AS video_id, COUNT(*) AS n FROM json_each(?) j JOIN external_video_views v ON v.rowid = j.value GROUP BY v.video_id) AS c
      WHERE external_videos.id = c.video_id`).bind(list),
    db.prepare("DELETE FROM external_video_views WHERE rowid IN (SELECT value FROM json_each(?))").bind(list),
  ]);
  return Number(deleted?.meta?.changes ?? 0);
}

export async function runPrivacyRetention(db: D1Database, now = new Date(), options: Options = {}): Promise<Result> {
  const batch = options.batch ?? PRIVACY_RETENTION_BATCH;
  const passes = options.maxPasses ?? MAX_PASSES;
  const out: Result = {};
  const viewerCutoffDate = dateBefore(now, VIEWER_HASH_RETENTION_DAYS);
  const record = (table: string, n: number) => { if (n) out[table] = (out[table] ?? 0) + n; };

  // A table missing on an older database must not stop the others.
  try { record("external_video_views", await repeat(passes, batch, () => purgeVideoViews(db, viewerCutoffDate, batch))); } catch { /* next run */ }
  for (const rule of DELETE_RULES) {
    try {
      record(rule.table, await repeat(passes, batch, async () =>
        Number((await db.prepare(rule.sql).bind(viewerCutoffDate, batch).run()).meta.changes ?? 0)));
    } catch { /* next run */ }
  }
  for (const rule of NULL_RULES) {
    const cutoff = isoBefore(now, rule.days);
    try {
      record(rule.table, await repeat(passes, batch, async () =>
        Number((await db.prepare(rule.sql).bind(cutoff, batch).run()).meta.changes ?? 0)));
    } catch { /* next run */ }
  }
  return out;
}
