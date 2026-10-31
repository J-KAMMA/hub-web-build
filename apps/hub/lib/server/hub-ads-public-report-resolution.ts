import type { D1Database } from "@cloudflare/workers-types";

export type HubAdPublicReportDecision = "reviewed" | "dismissed";

export type HubAdPublicReportResolutionReceipt = {
  auditId: string;
  action: `public_report.${HubAdPublicReportDecision}`;
  targetId: string;
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdPublicReportResolutionResult =
  | { status: "resolved" | "replayed"; receipt: HubAdPublicReportResolutionReceipt }
  | { status: "conflict"; reason: "operation_id_reused" | "not_found_or_closed" };

type ResolutionRow = {
  id: string;
  status: HubAdPublicReportDecision;
  resolutionAuditId: string;
  reviewedAt: number;
};

async function findOperation(database: D1Database, operationId: string) {
  return database.prepare(`SELECT id,status,resolution_audit_id resolutionAuditId,reviewed_at reviewedAt
    FROM hub_ad_public_reports WHERE resolution_audit_id=? LIMIT 1`)
    .bind(operationId).first<ResolutionRow>();
}

async function auditIdExists(database: D1Database, operationId: string) {
  return Boolean(await database.prepare("SELECT id FROM hub_ad_audit_logs WHERE id=? LIMIT 1")
    .bind(operationId).first<{ id: string }>());
}

function receipt(row: ResolutionRow, replayed: boolean): HubAdPublicReportResolutionReceipt {
  return {
    auditId: row.resolutionAuditId,
    action: `public_report.${row.status}`,
    targetId: row.id,
    confirmedAt: row.reviewedAt,
    replayed,
  };
}

function replayResult(
  row: ResolutionRow | null,
  input: { reportId: string; decision: HubAdPublicReportDecision },
): HubAdPublicReportResolutionResult | null {
  if (!row) return null;
  if (row.id !== input.reportId || row.status !== input.decision) {
    return { status: "conflict", reason: "operation_id_reused" };
  }
  return { status: "replayed", receipt: receipt(row, true) };
}

export async function resolveHubAdPublicReport(
  database: D1Database,
  input: { reportId: string; operationId: string; decision: HubAdPublicReportDecision },
  now = Date.now(),
): Promise<HubAdPublicReportResolutionResult> {
  const existing = replayResult(await findOperation(database, input.operationId), input);
  if (existing) return existing;
  if (await auditIdExists(database, input.operationId)) {
    return { status: "conflict", reason: "operation_id_reused" };
  }

  try {
    const updated = await database.prepare(`UPDATE hub_ad_public_reports
      SET status=?,reviewed_at=?,resolution_audit_id=?
      WHERE id=? AND status='open'`)
      .bind(input.decision, now, input.operationId, input.reportId)
      .run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, input.operationId);
      if (!row) throw new Error("hub_ad_public_report_resolution_receipt_missing");
      return { status: "resolved", receipt: receipt(row, false) };
    }
  } catch {
    // A concurrent request may have committed first. Only an exact replay is
    // acknowledged; every other collision remains a conflict.
    const concurrent = replayResult(await findOperation(database, input.operationId), input);
    if (concurrent) return concurrent;
    if (await auditIdExists(database, input.operationId)) {
      return { status: "conflict", reason: "operation_id_reused" };
    }
  }

  return { status: "conflict", reason: "not_found_or_closed" };
}
