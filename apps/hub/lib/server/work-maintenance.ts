import type { D1Database } from "@cloudflare/workers-types";

import { WORK_THREAD_RETENTION_DAYS } from "@/lib/work-commissions";

/*
 * 指名依頼の定期処理 (docs/hub-commissions/DESIGN.md 6.4, 12-5).
 *
 * - Notices: the state-change notices (workStateNotices) and the "review ends within 24 hours" sweep. A notice
 *   carries a fixed sentence and a link to the contract page only: no title, no brief, no amount, no handle,
 *   no wallet address, and nothing that tells adult work apart.
 * - Purge: thread messages of a contract closed more than 1 year ago. Thread messages carry no attachments (DESIGN
 *   6.4), and this never touches work_contracts' payment fields, work_deliveries, or anything at Commerce or on chain.
 *
 * D1 bills rows read and written. Both sweeps walk a partial index (migration 0303) with a keyset cursor, never
 * OFFSET, in bounded passes; what is left is taken by the next hourly run.
 */

const DAY = 86_400_000;
export const WORK_MAINTENANCE_BATCH = 100;
export const WORK_MAINTENANCE_MAX_PASSES = 3;
export const WORK_PURGE_MESSAGES_PER_CONTRACT = 500;
export const WORK_REVIEW_NOTICE_HOURS = 24;

export type WorkNoticeKind =
  | "received" | "accepted" | "declined" | "delivered" | "review_ending" | "released" | "disputed" | "refunded" | "expired";
type Side = "client" | "worker" | "both";

const TEXT: Record<WorkNoticeKind, string> = {
  received: "新しい依頼が届きました。",
  accepted: "依頼が受けられました。",
  declined: "依頼は受けられず、入金は返金されます。",
  delivered: "納品されました。確認期間が始まりました。",
  review_ending: "確認期間があと24時間以内に終わります。",
  released: "契約が完了し、支払が解放されました。",
  disputed: "未着の申し立てがありました。",
  refunded: "契約は返金で終わりました。",
  expired: "期限を過ぎたため、契約は返金で終わりました。",
};

export type WorkNoticeParties = { contractId: string; clientId: string; workerId: string };

/** Who hears about a move to `to`. A request that was never taken (funded -> refunded) is told to the client only. */
export function workStateNotices(from: string, to: string): Array<{ kind: WorkNoticeKind; side: Side }> {
  if (to === "funded") return [{ kind: "received", side: "worker" }];
  if (to === "accepted") return [{ kind: "accepted", side: "client" }];
  if (to === "delivered") return [{ kind: "delivered", side: "client" }];
  if (to === "flagged") return [{ kind: "disputed", side: "worker" }];
  if (to === "released") return [{ kind: "released", side: "both" }];
  if (to === "refunded") {
    if (from === "funded") return [{ kind: "declined", side: "client" }];
    if (from === "accepted") return [{ kind: "expired", side: "both" }];
    return [{ kind: "refunded", side: "both" }];
  }
  return [];
}

/**
 * One INSERT per receiver, written so a repeat of the same event inserts nothing (the key is part of target_id,
 * the same shape as the other "system" notices).
 */
function noticeStatement(db: D1Database, receiverId: string, contractId: string, kind: WorkNoticeKind, at: string) {
  const targetId = `/v2/commissions/${contractId}#event=work:${contractId}:${kind}`;
  return db.prepare(`INSERT INTO notifications
    (id, receiver_profile_id, actor_profile_id, notification_type, target_type, target_id, text, is_read, created_at)
    SELECT ?, ?, NULL, 'system', 'system', ?, ?, 0, ?
    WHERE NOT EXISTS (SELECT 1 FROM notifications
      WHERE receiver_profile_id = ? AND notification_type = 'system' AND target_type = 'system' AND target_id = ?)`)
    .bind(crypto.randomUUID(), receiverId, targetId, TEXT[kind], at, receiverId, targetId);
}

function noticeStatements(db: D1Database, parties: WorkNoticeParties, kind: WorkNoticeKind, side: Side, at: string) {
  const out = [];
  if (side !== "worker") out.push(noticeStatement(db, parties.clientId, parties.contractId, kind, at));
  if (side !== "client") out.push(noticeStatement(db, parties.workerId, parties.contractId, kind, at));
  return out;
}

/** Best effort: a failed notice never blocks a state change. */
export async function notifyWorkStateChange(db: D1Database, parties: WorkNoticeParties, from: string, to: string, at: string): Promise<void> {
  const statements = workStateNotices(from, to).flatMap((notice) => noticeStatements(db, parties, notice.kind, notice.side, at));
  if (!statements.length) return;
  await db.batch(statements).catch(() => undefined);
}

type ReviewRow = { id: string; client_profile_id: string; worker_profile_id: string; release_at: string };

/**
 * Tells both sides, once, that the review period of a delivered contract ends within 24 hours. Reads at most
 * BATCH x MAX_PASSES index rows (plus their contract rows); writes 3 rows per contract (two notices, one marker).
 * An idle run reads zero rows.
 */
export async function notifyWorkReviewsEnding(
  db: D1Database,
  now = new Date(),
  options: { batch?: number; maxPasses?: number } = {},
): Promise<{ notified: number }> {
  const batch = options.batch ?? WORK_MAINTENANCE_BATCH;
  const nowIso = now.toISOString();
  const until = new Date(now.getTime() + WORK_REVIEW_NOTICE_HOURS * 3_600_000).toISOString();
  let notified = 0;
  let cursor: { releaseAt: string; id: string } | null = null;
  for (let pass = 0; pass < (options.maxPasses ?? WORK_MAINTENANCE_MAX_PASSES); pass += 1) {
    const found: { results?: ReviewRow[] } = await db.prepare(`SELECT id, client_profile_id, worker_profile_id, release_at FROM work_contracts
      WHERE escrow_state = 'delivered' AND review_notified_at IS NULL AND release_at IS NOT NULL
        AND release_at > ? AND release_at <= ? AND (release_at > ? OR (release_at = ? AND id > ?))
      ORDER BY release_at, id LIMIT ?`)
      .bind(nowIso, until, cursor?.releaseAt ?? "", cursor?.releaseAt ?? "", cursor?.id ?? "", batch).all<ReviewRow>();
    const rows = found.results ?? [];
    if (!rows.length) break;
    await db.batch(rows.flatMap((row) => [
      ...noticeStatements(db, { contractId: row.id, clientId: row.client_profile_id, workerId: row.worker_profile_id }, "review_ending", "both", nowIso),
      db.prepare("UPDATE work_contracts SET review_notified_at = ? WHERE id = ? AND escrow_state = 'delivered' AND review_notified_at IS NULL").bind(nowIso, row.id),
    ]));
    notified += rows.length;
    const last = rows[rows.length - 1]!;
    cursor = { releaseAt: last.release_at, id: last.id };
    if (rows.length < batch) break;
  }
  return { notified };
}

/**
 * Deletes thread messages of contracts closed WORK_THREAD_RETENTION_DAYS ago, then marks the contract purged once
 * none remain. Per contract at most MESSAGES messages are deleted in a run (a bigger thread finishes next run).
 * Reads: <= BATCH x MAX_PASSES contract index rows + their row, plus the messages it deletes. Writes: each deleted
 * message (and its 3 index entries) + one marker row per finished contract. An idle run reads zero rows.
 */
export async function purgeExpiredWorkThreads(
  db: D1Database,
  now = new Date(),
  options: { batch?: number; maxPasses?: number; messagesPerContract?: number } = {},
): Promise<{ contracts: number; messages: number }> {
  const batch = options.batch ?? WORK_MAINTENANCE_BATCH;
  const perContract = options.messagesPerContract ?? WORK_PURGE_MESSAGES_PER_CONTRACT;
  const cutoff = new Date(now.getTime() - WORK_THREAD_RETENTION_DAYS * DAY).toISOString();
  const markedAt = now.toISOString();
  let contracts = 0;
  let messages = 0;
  let cursor: { closedAt: string; id: string } | null = null;
  for (let pass = 0; pass < (options.maxPasses ?? WORK_MAINTENANCE_MAX_PASSES); pass += 1) {
    const found: { results?: Array<{ id: string; closed_at: string }> } = await db.prepare(`SELECT id, closed_at FROM work_contracts
      WHERE closed_at IS NOT NULL AND thread_purged_at IS NULL AND closed_at <= ?
        AND (closed_at > ? OR (closed_at = ? AND id > ?))
      ORDER BY closed_at, id LIMIT ?`)
      .bind(cutoff, cursor?.closedAt ?? "", cursor?.closedAt ?? "", cursor?.id ?? "", batch).all<{ id: string; closed_at: string }>();
    const rows = found.results ?? [];
    if (!rows.length) break;
    const results = await db.batch(rows.flatMap((row) => [
      db.prepare(`DELETE FROM work_thread_messages WHERE id IN (
        SELECT id FROM work_thread_messages WHERE contract_id = ? ORDER BY created_at, id LIMIT ?)`).bind(row.id, perContract),
      db.prepare(`UPDATE work_contracts SET thread_purged_at = ?
        WHERE id = ? AND NOT EXISTS (SELECT 1 FROM work_thread_messages WHERE contract_id = ?)`).bind(markedAt, row.id, row.id),
    ]));
    for (let index = 0; index < rows.length; index += 1) {
      messages += Number(results[index * 2]?.meta?.changes ?? 0);
      contracts += Number(results[index * 2 + 1]?.meta?.changes ?? 0);
    }
    const last = rows[rows.length - 1]!;
    cursor = { closedAt: last.closed_at, id: last.id };
    if (rows.length < batch) break;
  }
  return { contracts, messages };
}

export async function runWorkCommissionMaintenance(db: D1Database, now = new Date()) {
  try {
    return await runWorkCommissionMaintenanceUnchecked(db, now);
  } catch (cause) {
    /* Code can deploy before migration 0303: a missing table or column means nothing to do yet, not a DLQ message every hour. */
    if (/no such (table|column)/i.test(cause instanceof Error ? cause.message : String(cause))) return { skipped: "work_tables_missing" as const };
    throw cause;
  }
}

async function runWorkCommissionMaintenanceUnchecked(db: D1Database, now: Date) {
  const reviews = await notifyWorkReviewsEnding(db, now);
  const purge = await purgeExpiredWorkThreads(db, now);
  return { reviewsNotified: reviews.notified, contractsPurged: purge.contracts, messagesPurged: purge.messages };
}
