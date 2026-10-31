import type { D1Database } from "@cloudflare/workers-types";

export type HubAdAdvertiserStatus = "pending" | "active" | "suspended" | "closed";
export type HubAdAdvertiserDecision = Exclude<HubAdAdvertiserStatus, "pending">;

export type HubAdAdvertiserReviewReceipt = {
  auditId: string;
  action: "advertiser.reviewed";
  targetId: string;
  fromStatus: HubAdAdvertiserStatus;
  toStatus: HubAdAdvertiserDecision;
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdAdvertiserReviewResult =
  | { status: "reviewed" | "replayed"; receipt: HubAdAdvertiserReviewReceipt }
  | { status: "not_found" }
  | { status: "conflict"; reason: "operation_id_reused" | "already_in_state" | "invalid_transition" | "state_changed" };

type ReviewAuditRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  fromStatus: HubAdAdvertiserStatus;
  decision: HubAdAdvertiserDecision;
  reason: string;
  occurredAt: number;
};

async function findOperation(database: D1Database, operationId: string) {
  return database.prepare(`SELECT id,action,target_type targetType,target_id targetId,
      json_extract(before_json,'$.status') fromStatus,
      json_extract(after_json,'$.decision') decision,
      json_extract(after_json,'$.reason') reason,occurred_at occurredAt
    FROM hub_ad_audit_logs WHERE id=? LIMIT 1`)
    .bind(operationId).first<ReviewAuditRow>();
}

function receipt(row: ReviewAuditRow, replayed: boolean): HubAdAdvertiserReviewReceipt {
  return {
    auditId: row.id,
    action: "advertiser.reviewed",
    targetId: row.targetId,
    fromStatus: row.fromStatus,
    toStatus: row.decision,
    confirmedAt: row.occurredAt,
    replayed,
  };
}

function replayResult(
  row: ReviewAuditRow | null,
  input: { advertiserRef: string; decision: HubAdAdvertiserDecision; reason: string },
): HubAdAdvertiserReviewResult | null {
  if (!row) return null;
  if (
    row.action !== "advertiser.reviewed"
    || row.targetType !== "advertiser"
    || row.targetId !== input.advertiserRef
    || row.decision !== input.decision
    || row.reason !== input.reason
  ) return { status: "conflict", reason: "operation_id_reused" };
  return { status: "replayed", receipt: receipt(row, true) };
}

function transitionAllowed(from: HubAdAdvertiserStatus, to: HubAdAdvertiserDecision) {
  if (from === "pending") return true;
  if (from === "active") return to === "suspended" || to === "closed";
  if (from === "suspended") return to === "active" || to === "closed";
  return false;
}

export async function reviewHubAdAdvertiser(
  database: D1Database,
  rawInput: { advertiserRef: string; operationId: string; decision: HubAdAdvertiserDecision; reason: string },
  now = Date.now(),
): Promise<HubAdAdvertiserReviewResult> {
  const input = { ...rawInput, reason: rawInput.reason.trim() };
  const existing = replayResult(await findOperation(database, input.operationId), input);
  if (existing) return existing;

  const advertiser = await database.prepare("SELECT status FROM hub_ad_advertisers WHERE advertiser_ref=?")
    .bind(input.advertiserRef).first<{ status: HubAdAdvertiserStatus }>();
  if (!advertiser) return { status: "not_found" };
  // Another request can commit between the first operation lookup and this
  // state read. Re-check before classifying an exact retry as a no-op.
  const afterStateRead = replayResult(await findOperation(database, input.operationId), input);
  if (afterStateRead) return afterStateRead;
  if (advertiser.status === input.decision) return { status: "conflict", reason: "already_in_state" };
  if (!transitionAllowed(advertiser.status, input.decision)) {
    return { status: "conflict", reason: "invalid_transition" };
  }

  try {
    const updated = await database.prepare(`UPDATE hub_ad_advertisers
      SET status=?,review_reason=?,review_audit_id=?,reviewed_at=?,updated_at=?
      WHERE advertiser_ref=? AND status=?`)
      .bind(input.decision, input.reason, input.operationId, now, now, input.advertiserRef, advertiser.status)
      .run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, input.operationId);
      if (!row) throw new Error("hub_ad_advertiser_review_receipt_missing");
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
