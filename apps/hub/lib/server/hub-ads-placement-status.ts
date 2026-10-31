import type { D1Database } from "@cloudflare/workers-types";

export type HubAdPlacementStatus = "active" | "paused" | "archived";

export type HubAdPlacementStatusReceipt = {
  auditId: string;
  action: "placement.status_changed";
  targetId: string;
  fromStatus: "draft" | HubAdPlacementStatus;
  toStatus: HubAdPlacementStatus;
  version: number;
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdPlacementStatusResult =
  | { status: "changed" | "replayed"; receipt: HubAdPlacementStatusReceipt }
  | { status: "not_found" }
  | { status: "conflict"; reason: "operation_id_reused" | "already_in_state" | "invalid_transition" | "state_changed" };

type PlacementRow = { status: string; statusVersion: number };
type AuditRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  fromStatus: HubAdPlacementStatusReceipt["fromStatus"];
  toStatus: HubAdPlacementStatus;
  reason: string;
  version: number;
  occurredAt: number;
};

async function findOperation(database: D1Database, operationId: string) {
  return database.prepare(`SELECT id,action,target_type targetType,target_id targetId,
      json_extract(before_json,'$.status') fromStatus,
      json_extract(after_json,'$.status') toStatus,
      json_extract(after_json,'$.reason') reason,
      json_extract(after_json,'$.version') version,
      occurred_at occurredAt
    FROM hub_ad_audit_logs WHERE id=? LIMIT 1`)
    .bind(operationId).first<AuditRow>();
}

function receipt(row: AuditRow, replayed: boolean): HubAdPlacementStatusReceipt {
  return {
    auditId: row.id,
    action: "placement.status_changed",
    targetId: row.targetId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    version: Number(row.version),
    confirmedAt: row.occurredAt,
    replayed,
  };
}

function replayResult(
  row: AuditRow | null,
  input: { placementId: string; nextStatus: HubAdPlacementStatus; reason: string },
): HubAdPlacementStatusResult | null {
  if (!row) return null;
  if (
    row.action !== "placement.status_changed"
    || row.targetType !== "placement"
    || row.targetId !== input.placementId
    || row.toStatus !== input.nextStatus
    || row.reason !== input.reason
  ) return { status: "conflict", reason: "operation_id_reused" };
  return { status: "replayed", receipt: receipt(row, true) };
}

function transitionAllowed(current: string, next: HubAdPlacementStatus) {
  return (
    (current === "draft" && (next === "active" || next === "archived"))
    || (current === "active" && (next === "paused" || next === "archived"))
    || (current === "paused" && (next === "active" || next === "archived"))
  );
}

export async function setHubAdPlacementStatus(
  database: D1Database,
  rawInput: { placementId: string; operationId: string; nextStatus: HubAdPlacementStatus; reason: string },
  now = Date.now(),
): Promise<HubAdPlacementStatusResult> {
  const input = { ...rawInput, reason: rawInput.reason.trim() };
  const existing = replayResult(await findOperation(database, input.operationId), input);
  if (existing) return existing;

  const current = await database.prepare(`SELECT status,status_version statusVersion
    FROM hub_ad_placements WHERE id=?`).bind(input.placementId).first<PlacementRow>();
  if (!current) return { status: "not_found" };
  const afterStateRead = replayResult(await findOperation(database, input.operationId), input);
  if (afterStateRead) return afterStateRead;
  if (current.status === input.nextStatus) return { status: "conflict", reason: "already_in_state" };
  if (!transitionAllowed(current.status, input.nextStatus)) {
    return { status: "conflict", reason: "invalid_transition" };
  }

  try {
    const updated = await database.prepare(`UPDATE hub_ad_placements
      SET status=?,status_reason=?,status_audit_id=?,status_changed_at=?,
        status_version=status_version+1,updated_at=?
      WHERE id=? AND status=? AND status_version=?`)
      .bind(input.nextStatus, input.reason, input.operationId, now, now,
        input.placementId, current.status, current.statusVersion).run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, input.operationId);
      if (!row) throw new Error("hub_ad_placement_status_receipt_missing");
      return { status: "changed", receipt: receipt(row, false) };
    }
  } catch {
    const concurrent = replayResult(await findOperation(database, input.operationId), input);
    if (concurrent) return concurrent;
  }

  const committedWhileUpdating = replayResult(await findOperation(database, input.operationId), input);
  if (committedWhileUpdating) return committedWhileUpdating;
  return { status: "conflict", reason: "state_changed" };
}
