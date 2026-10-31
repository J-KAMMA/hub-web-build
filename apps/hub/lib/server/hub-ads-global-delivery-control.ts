import type { D1Database } from "@cloudflare/workers-types";

export type HubAdsGlobalDeliveryReceipt = {
  auditId: string;
  action: "ads.paused" | "ads.resumed";
  targetId: "global";
  fromPaused: boolean;
  toPaused: boolean;
  version: number;
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdsGlobalDeliveryResult =
  | { status: "changed" | "replayed"; receipt: HubAdsGlobalDeliveryReceipt }
  | { status: "unavailable" }
  | { status: "conflict"; reason: "operation_id_reused" | "already_in_state" | "state_changed" };

type ControlRow = { adsPaused: number; reason: string; controlVersion: number };
type AuditRow = {
  id: string;
  action: "ads.paused" | "ads.resumed";
  targetType: string;
  targetId: string;
  fromPaused: number;
  toPaused: number;
  reason: string;
  version: number;
  occurredAt: number;
};

async function findOperation(database: D1Database, operationId: string) {
  return database.prepare(`SELECT id,action,target_type targetType,target_id targetId,
      json_extract(before_json,'$.paused') fromPaused,
      json_extract(after_json,'$.paused') toPaused,
      json_extract(after_json,'$.reason') reason,
      json_extract(after_json,'$.version') version,
      occurred_at occurredAt
    FROM hub_ad_audit_logs WHERE id=? LIMIT 1`)
    .bind(operationId).first<AuditRow>();
}

function receipt(row: AuditRow, replayed: boolean): HubAdsGlobalDeliveryReceipt {
  return {
    auditId: row.id,
    action: row.action,
    targetId: "global",
    fromPaused: Boolean(row.fromPaused),
    toPaused: Boolean(row.toPaused),
    version: Number(row.version),
    confirmedAt: row.occurredAt,
    replayed,
  };
}

function replayResult(
  row: AuditRow | null,
  input: { paused: boolean; reason: string },
): HubAdsGlobalDeliveryResult | null {
  if (!row) return null;
  const expectedAction = input.paused ? "ads.paused" : "ads.resumed";
  if (
    row.action !== expectedAction
    || row.targetType !== "system"
    || row.targetId !== "global"
    || Boolean(row.toPaused) !== input.paused
    || row.reason !== input.reason
  ) return { status: "conflict", reason: "operation_id_reused" };
  return { status: "replayed", receipt: receipt(row, true) };
}

export async function setHubAdsGlobalPause(
  database: D1Database,
  rawInput: { operationId: string; paused: boolean; reason: string },
  now = Date.now(),
): Promise<HubAdsGlobalDeliveryResult> {
  const input = { ...rawInput, reason: rawInput.reason.trim() };
  const existing = replayResult(await findOperation(database, input.operationId), input);
  if (existing) return existing;

  const current = await database.prepare(`SELECT ads_paused adsPaused,reason,control_version controlVersion
    FROM hub_ad_system_controls WHERE control_key='global' LIMIT 1`).first<ControlRow>();
  if (!current) return { status: "unavailable" };
  const afterStateRead = replayResult(await findOperation(database, input.operationId), input);
  if (afterStateRead) return afterStateRead;
  if (Boolean(current.adsPaused) === input.paused) {
    return { status: "conflict", reason: "already_in_state" };
  }

  try {
    const updated = await database.prepare(`UPDATE hub_ad_system_controls
      SET ads_paused=?,reason=?,changed_by_actor_key='moderation-admin',changed_at=?,
        control_version=control_version+1,change_audit_id=?
      WHERE control_key='global' AND ads_paused=? AND control_version=?`)
      .bind(input.paused ? 1 : 0, input.reason, now, input.operationId, current.adsPaused, current.controlVersion).run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, input.operationId);
      if (!row) throw new Error("hub_ad_global_delivery_receipt_missing");
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
