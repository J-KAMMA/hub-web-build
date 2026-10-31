import type { D1Database } from "@cloudflare/workers-types";

export type HubAdTrafficReviewDecision = "reviewed" | "dismissed";

export type HubAdTrafficReviewReceipt = {
  auditId: string;
  action: "traffic_review.resolved";
  targetId: string;
  fromStatus: "open";
  toStatus: HubAdTrafficReviewDecision;
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdTrafficReviewResult =
  | { status: "reviewed" | "replayed"; receipt: HubAdTrafficReviewReceipt }
  | { status: "not_found" }
  | { status: "conflict"; reason: "operation_id_reused" | "already_in_state" | "state_changed" };

type TrafficReviewRow = {
  id: string;
  status: string;
  reviewNote: string | null;
  reviewAuditId: string | null;
  reviewedAt: number | null;
};

async function findOperation(database: D1Database, operationId: string) {
  return database.prepare(`SELECT id,status,review_note reviewNote,
      review_audit_id reviewAuditId,reviewed_at reviewedAt
    FROM hub_ad_traffic_reviews WHERE review_audit_id=? LIMIT 1`)
    .bind(operationId).first<TrafficReviewRow>();
}

async function auditIdExists(database: D1Database, operationId: string) {
  return Boolean(await database.prepare("SELECT id FROM hub_ad_audit_logs WHERE id=? LIMIT 1")
    .bind(operationId).first<{ id: string }>());
}

function receipt(row: TrafficReviewRow, replayed: boolean): HubAdTrafficReviewReceipt {
  return {
    auditId: row.reviewAuditId!,
    action: "traffic_review.resolved",
    targetId: row.id,
    fromStatus: "open",
    toStatus: row.status as HubAdTrafficReviewDecision,
    confirmedAt: row.reviewedAt!,
    replayed,
  };
}

function replayResult(
  row: TrafficReviewRow | null,
  input: { reviewId: string; decision: HubAdTrafficReviewDecision; note: string },
): HubAdTrafficReviewResult | null {
  if (!row) return null;
  if (
    row.id !== input.reviewId
    || row.status !== input.decision
    || row.reviewNote !== input.note
  ) return { status: "conflict", reason: "operation_id_reused" };
  return { status: "replayed", receipt: receipt(row, true) };
}

export async function reviewHubAdTrafficFlag(
  database: D1Database,
  rawInput: { reviewId: string; operationId: string; decision: HubAdTrafficReviewDecision; note: string },
  now = Date.now(),
): Promise<HubAdTrafficReviewResult> {
  const note = rawInput.note.trim();
  const input = { ...rawInput, note };
  const existing = replayResult(await findOperation(database, input.operationId), input);
  if (existing) return existing;
  if (await auditIdExists(database, input.operationId)) {
    return { status: "conflict", reason: "operation_id_reused" };
  }

  const current = await database.prepare(`SELECT id,status,review_note reviewNote,
      review_audit_id reviewAuditId,reviewed_at reviewedAt FROM hub_ad_traffic_reviews WHERE id=?`)
    .bind(input.reviewId).first<TrafficReviewRow>();
  if (!current) return { status: "not_found" };
  const afterStateRead = replayResult(await findOperation(database, input.operationId), input);
  if (afterStateRead) return afterStateRead;
  if (current.status === input.decision) return { status: "conflict", reason: "already_in_state" };
  if (current.status !== "open") return { status: "conflict", reason: "state_changed" };

  try {
    const updated = await database.prepare(`UPDATE hub_ad_traffic_reviews
      SET status=?,review_note=?,review_audit_id=?,reviewed_at=?,reviewed_by_actor_key='moderation-admin'
      WHERE id=? AND status='open'`)
      .bind(input.decision, note, input.operationId, now, input.reviewId).run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, input.operationId);
      if (!row) throw new Error("hub_ad_traffic_review_receipt_missing");
      return { status: "reviewed", receipt: receipt(row, false) };
    }
  } catch {
    const concurrent = replayResult(await findOperation(database, input.operationId), input);
    if (concurrent) return concurrent;
    if (await auditIdExists(database, input.operationId)) {
      return { status: "conflict", reason: "operation_id_reused" };
    }
  }

  const committedWhileUpdating = replayResult(await findOperation(database, input.operationId), input);
  if (committedWhileUpdating) return committedWhileUpdating;
  if (await auditIdExists(database, input.operationId)) {
    return { status: "conflict", reason: "operation_id_reused" };
  }
  return { status: "conflict", reason: "state_changed" };
}
