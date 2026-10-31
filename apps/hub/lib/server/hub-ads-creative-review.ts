import type { D1Database } from "@cloudflare/workers-types";

export type HubAdCreativeReviewStatus =
  | "pending"
  | "approved"
  | "approved_with_restrictions"
  | "needs_changes"
  | "rejected"
  | "escalated";
export type HubAdCreativeReviewDecision = "approved" | "needs_changes" | "rejected";

export type HubAdCreativeReviewReceipt = {
  auditId: string;
  action: "creative.reviewed";
  targetId: string;
  versionId: string;
  version: number;
  fromReviewStatus: HubAdCreativeReviewStatus;
  toReviewStatus: HubAdCreativeReviewDecision;
  creativeStatus: "approved" | "pending_review" | "rejected";
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdCreativeReviewResult =
  | { status: "reviewed" | "replayed"; receipt: HubAdCreativeReviewReceipt }
  | { status: "not_found" }
  | { status: "conflict"; reason: "operation_id_reused" | "already_in_state" | "invalid_transition" | "state_changed" };

type CreativeRow = {
  creativeStatus: string;
  versionId: string;
  version: number;
  reviewStatus: HubAdCreativeReviewStatus;
};

type ReviewAuditRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  versionId: string;
  version: number;
  fromReviewStatus: HubAdCreativeReviewStatus;
  decision: HubAdCreativeReviewDecision;
  reason: string;
  creativeStatus: "approved" | "pending_review" | "rejected";
  occurredAt: number;
};

async function findOperation(database: D1Database, operationId: string) {
  return database.prepare(`SELECT id,action,target_type targetType,target_id targetId,
      json_extract(before_json,'$.versionId') versionId,
      json_extract(before_json,'$.version') version,
      json_extract(before_json,'$.reviewStatus') fromReviewStatus,
      json_extract(after_json,'$.decision') decision,
      json_extract(after_json,'$.reason') reason,
      json_extract(after_json,'$.creativeStatus') creativeStatus,
      occurred_at occurredAt
    FROM hub_ad_audit_logs WHERE id=? LIMIT 1`)
    .bind(operationId).first<ReviewAuditRow>();
}

function receipt(row: ReviewAuditRow, replayed: boolean): HubAdCreativeReviewReceipt {
  return {
    auditId: row.id,
    action: "creative.reviewed",
    targetId: row.targetId,
    versionId: row.versionId,
    version: Number(row.version),
    fromReviewStatus: row.fromReviewStatus,
    toReviewStatus: row.decision,
    creativeStatus: row.creativeStatus,
    confirmedAt: row.occurredAt,
    replayed,
  };
}

function replayResult(
  row: ReviewAuditRow | null,
  input: { creativeId: string; decision: HubAdCreativeReviewDecision; reason: string },
): HubAdCreativeReviewResult | null {
  if (!row) return null;
  if (
    row.action !== "creative.reviewed"
    || row.targetType !== "creative"
    || row.targetId !== input.creativeId
    || row.decision !== input.decision
    || row.reason !== input.reason
  ) return { status: "conflict", reason: "operation_id_reused" };
  return { status: "replayed", receipt: receipt(row, true) };
}

export async function reviewHubAdCreative(
  database: D1Database,
  rawInput: { creativeId: string; operationId: string; decision: HubAdCreativeReviewDecision; reason: string },
  now = Date.now(),
): Promise<HubAdCreativeReviewResult> {
  const input = { ...rawInput, reason: rawInput.reason.trim() };
  const existing = replayResult(await findOperation(database, input.operationId), input);
  if (existing) return existing;

  const creative = await database.prepare(`SELECT creative.status creativeStatus,
      version.id versionId,version.version,version.review_status reviewStatus
    FROM hub_ad_creatives creative
    JOIN hub_ad_creative_versions version
      ON version.creative_id=creative.id AND version.version=creative.current_version
    WHERE creative.id=?`)
    .bind(input.creativeId).first<CreativeRow>();
  if (!creative) return { status: "not_found" };
  const afterStateRead = replayResult(await findOperation(database, input.operationId), input);
  if (afterStateRead) return afterStateRead;
  if (creative.reviewStatus === input.decision) return { status: "conflict", reason: "already_in_state" };
  if (creative.creativeStatus !== "pending_review" || !["pending", "escalated"].includes(creative.reviewStatus)) {
    return { status: "conflict", reason: "invalid_transition" };
  }

  try {
    const updated = await database.prepare(`UPDATE hub_ad_creative_versions
      SET review_status=?,review_reason=?,review_audit_id=?,reviewed_by_actor_key='moderation-admin',reviewed_at=?
      WHERE id=? AND creative_id=? AND version=? AND review_status=?
        AND EXISTS (SELECT 1 FROM hub_ad_creatives creative
          WHERE creative.id=? AND creative.current_version=? AND creative.status='pending_review')`)
      .bind(input.decision, input.reason, input.operationId, now,
        creative.versionId, input.creativeId, creative.version, creative.reviewStatus,
        input.creativeId, creative.version)
      .run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, input.operationId);
      if (!row) throw new Error("hub_ad_creative_review_receipt_missing");
      return { status: "reviewed", receipt: receipt(row, false) };
    }
  } catch {
    const concurrent = replayResult(await findOperation(database, input.operationId), input);
    if (concurrent) return concurrent;
  }

  const committedWhileUpdating = replayResult(await findOperation(database, input.operationId), input);
  if (committedWhileUpdating) return committedWhileUpdating;
  return { status: "conflict", reason: "state_changed" };
}
