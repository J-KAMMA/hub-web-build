import type { D1Database } from "@cloudflare/workers-types";

export type HubAdAppealDecision = "accepted" | "rejected";

export type HubAdAppealResolutionReceipt = {
  auditId: string;
  action: `appeal.${HubAdAppealDecision}`;
  targetId: string;
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdAppealResolutionResult =
  | { status: "resolved" | "replayed"; receipt: HubAdAppealResolutionReceipt }
  | { status: "conflict"; reason: "operation_id_reused" | "not_found_or_closed" };

type ResolutionRow = {
  id: string;
  status: HubAdAppealDecision;
  resolutionNote: string;
  resolutionAuditId: string;
  resolvedAt: number;
};

const RESOLUTION_BY_OPERATION_SQL = `SELECT id,status,resolution_note resolutionNote,
  resolution_audit_id resolutionAuditId,resolved_at resolvedAt
  FROM hub_ad_review_appeals WHERE resolution_audit_id=? LIMIT 1`;

async function findOperation(database: D1Database, operationId: string) {
  return database.prepare(RESOLUTION_BY_OPERATION_SQL).bind(operationId).first<ResolutionRow>();
}

async function auditIdExists(database: D1Database, operationId: string) {
  return Boolean(await database.prepare("SELECT id FROM hub_ad_audit_logs WHERE id=? LIMIT 1")
    .bind(operationId).first<{ id: string }>());
}

function receipt(row: ResolutionRow, replayed: boolean): HubAdAppealResolutionReceipt {
  return {
    auditId: row.resolutionAuditId,
    action: `appeal.${row.status}`,
    targetId: row.id,
    confirmedAt: row.resolvedAt,
    replayed,
  };
}

function replayResult(row: ResolutionRow | null, input: {
  appealId: string;
  decision: HubAdAppealDecision;
  note: string;
}): HubAdAppealResolutionResult | null {
  if (!row) return null;
  if (row.id !== input.appealId || row.status !== input.decision || row.resolutionNote !== input.note) {
    return { status: "conflict", reason: "operation_id_reused" };
  }
  return { status: "replayed", receipt: receipt(row, true) };
}

export async function resolveHubAdReviewAppeal(
  database: D1Database,
  input: { appealId: string; operationId: string; decision: HubAdAppealDecision; note: string },
  now = Date.now(),
): Promise<HubAdAppealResolutionResult> {
  const normalized = { ...input, note: input.note.trim() };
  const existing = replayResult(await findOperation(database, normalized.operationId), normalized);
  if (existing) return existing;
  if (await auditIdExists(database, normalized.operationId)) {
    return { status: "conflict", reason: "operation_id_reused" };
  }

  try {
    const updated = await database.prepare(`UPDATE hub_ad_review_appeals
      SET status=?,resolution_note=?,resolved_at=?,resolution_audit_id=?
      WHERE id=? AND status='open'`)
      .bind(normalized.decision, normalized.note, now, normalized.operationId, normalized.appealId)
      .run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, normalized.operationId);
      if (!row) throw new Error("hub_ad_appeal_resolution_receipt_missing");
      return { status: "resolved", receipt: receipt(row, false) };
    }
  } catch {
    // A concurrent request may have committed first, or this operation id may
    // belong to another appeal. Only an exact replay is safe to acknowledge.
    const concurrent = replayResult(await findOperation(database, normalized.operationId), normalized);
    if (concurrent) return concurrent;
    if (await auditIdExists(database, normalized.operationId)) {
      return { status: "conflict", reason: "operation_id_reused" };
    }
  }

  return { status: "conflict", reason: "not_found_or_closed" };
}
