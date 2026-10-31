import type { D1Database } from "@cloudflare/workers-types";

/*
 * Deletes rows whose only purpose was technical and whose time has passed: rate-limit windows,
 * one-time challenges, token-gate check cache, peer signalling. Nothing here has a retention
 * question attached; a row past its own expiry is dead weight (and, for the rate-limit tables,
 * a record of who acted when).
 *
 * D1 bills rows read and written, so each pass deletes at most BATCH rows per table, up to MAX_PASSES
 * times, picking victims by rowid out of an expiry-ordered subselect (the expiry columns are indexed).
 * Whatever is left is taken by the next hourly run.
 */
const BATCH = 500;
const MAX_PASSES = 4;
const CHALLENGE_GRACE_MS = 60 * 60 * 1000;
const MCP_RATE_LIMIT_RETENTION_DAYS = 7;

/** `graceDays` keeps the row that long past `column`; `where` is a fixed SQL condition (never built from input). */
type Rule = { table: string; column: string; bound: "iso" | "epochMs" | "date"; graceDays?: number; where?: string };

/** Tables are fixed here; never built from input. */
const RULES: Rule[] = [
  { table: "hub_rate_limit_buckets", column: "expires_at", bound: "iso" },
  { table: "hub_reaction_rate_limit_buckets", column: "expires_at", bound: "iso" },
  { table: "video_search_rate_limits", column: "expires_at", bound: "iso" },
  { table: "direct_message_rate_limits", column: "expires_at", bound: "iso" },
  { table: "hub_social_post_rate_limit_buckets", column: "expires_at", bound: "iso" },
  { table: "hub_user_article_rate_limit_buckets", column: "expires_at", bound: "iso" },
  { table: "hub_user_article_comment_rate_limit_buckets", column: "expires_at", bound: "iso" },
  { table: "hub_wallet_bundler_rate_limits", column: "expires_at", bound: "iso" },
  { table: "access_gate_checks", column: "expires_at", bound: "iso" },
  { table: "token_balance_challenges", column: "expires_at", bound: "iso" },
  { table: "passkey_challenges", column: "expires_at", bound: "iso" },
  { table: "wallet_account_link_challenges", column: "expires_at", bound: "iso" },
  { table: "market_ticket_checkin_challenges", column: "expires_at", bound: "iso" },
  { table: "hub_selective_credential_challenges", column: "expires_at", bound: "iso" },
  { table: "p2p_device_invitations", column: "expires_at", bound: "epochMs" },
  { table: "public_post_peer_signals", column: "expires_at", bound: "epochMs" },
  { table: "hubpedia_mcp_rate_limits", column: "usage_date", bound: "date" },
  // Watermark ID -> download mapping (2026-10-17): kept 365 days, then gone (content-downloads.ts).
  { table: "hub_download_grants", column: "purge_after", bound: "iso" },
  // Game build watermark ID -> purchase mapping: 3 years from the sale (DRM.md §10, game-builds.ts).
  { table: "hub_game_build_downloads", column: "purge_after", bound: "iso" },
  // Git push ledger (2026-10-17 re-audit): who pushed to which repository and when. Account holds the
  // storage truth, and Hub reads a row again only inside the 5-minute write ticket, so 30 days is ample.
  { table: "code_repository_pushes", column: "settled_at", bound: "iso", graceDays: 30 },
  { table: "code_repository_pushes", column: "created_at", bound: "iso", graceDays: 30, where: "state = 'reserved'" },
];

function boundFor(rule: Rule, now: Date): string | number {
  if (rule.bound === "epochMs") return now.getTime();
  if (rule.bound === "date") return new Date(now.getTime() - MCP_RATE_LIMIT_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  // Challenges are checked against their own expiry; a short grace keeps a just-expired
  // row available for a "this challenge expired" answer rather than "unknown challenge".
  const grace = rule.graceDays ? rule.graceDays * 86_400_000 : rule.table.endsWith("_challenges") ? CHALLENGE_GRACE_MS : 0;
  return new Date(now.getTime() - grace).toISOString();
}

export async function pruneExpiredTechnicalRows(database: D1Database, now = new Date()): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  for (const rule of RULES) {
    const limit = boundFor(rule, now);
    let total = 0;
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      let changes = 0;
      try {
        const result = await database.prepare(
          `DELETE FROM ${rule.table} WHERE rowid IN (SELECT rowid FROM ${rule.table} WHERE ${rule.column} < ?${rule.where ? ` AND ${rule.where}` : ""} ORDER BY ${rule.column} LIMIT ?)`,
        ).bind(limit, BATCH).run();
        changes = result.meta.changes ?? 0;
      } catch {
        // A table that does not exist yet on this database must not stop the other tables.
        break;
      }
      total += changes;
      if (changes < BATCH) break;
    }
    if (total) deleted[rule.table] = (deleted[rule.table] ?? 0) + total;
  }
  return deleted;
}
