import type { D1Database } from "@cloudflare/workers-types";

export type HubAdCampaignDeliveryAction = "activate" | "pause";

export type HubAdCampaignDeliveryReceipt = {
  auditId: string;
  action: "campaign.activated" | "campaign.paused";
  targetId: string;
  fromStatus: "approved" | "active" | "paused";
  toStatus: "active" | "paused";
  version: number;
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdCampaignDeliveryResult =
  | { status: "changed" | "replayed"; receipt: HubAdCampaignDeliveryReceipt }
  | { status: "not_found" }
  | { status: "conflict"; reason: "operation_id_reused" | "already_in_state" | "invalid_transition" | "not_ready" | "state_changed" };

type CampaignRow = { status: string; deliveryVersion: number };
type AuditRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  fromStatus: HubAdCampaignDeliveryReceipt["fromStatus"];
  toStatus: HubAdCampaignDeliveryReceipt["toStatus"];
  reason: string;
  version: number;
  occurredAt: number;
};

function targetStatus(action: HubAdCampaignDeliveryAction) {
  return action === "activate" ? "active" as const : "paused" as const;
}

function auditAction(action: HubAdCampaignDeliveryAction) {
  return action === "activate" ? "campaign.activated" as const : "campaign.paused" as const;
}

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

function receipt(row: AuditRow, replayed: boolean): HubAdCampaignDeliveryReceipt {
  return {
    auditId: row.id,
    action: row.action as HubAdCampaignDeliveryReceipt["action"],
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
  input: { campaignId: string; action: HubAdCampaignDeliveryAction; reason: string },
): HubAdCampaignDeliveryResult | null {
  if (!row) return null;
  if (
    row.action !== auditAction(input.action)
    || row.targetType !== "campaign"
    || row.targetId !== input.campaignId
    || row.toStatus !== targetStatus(input.action)
    || row.reason !== input.reason
  ) return { status: "conflict", reason: "operation_id_reused" };
  return { status: "replayed", receipt: receipt(row, true) };
}

function transitionAllowed(current: string, action: HubAdCampaignDeliveryAction) {
  if (action === "activate") return current === "approved" || current === "paused";
  return current === "approved" || current === "active";
}

export async function setHubAdCampaignDelivery(
  database: D1Database,
  rawInput: { campaignId: string; operationId: string; action: HubAdCampaignDeliveryAction; reason: string },
  now = Date.now(),
): Promise<HubAdCampaignDeliveryResult> {
  const input = { ...rawInput, reason: rawInput.reason.trim() };
  const existing = replayResult(await findOperation(database, input.operationId), input);
  if (existing) return existing;

  const current = await database.prepare(`SELECT status,delivery_version deliveryVersion
    FROM hub_ad_campaigns WHERE id=?`).bind(input.campaignId).first<CampaignRow>();
  if (!current) return { status: "not_found" };
  const afterStateRead = replayResult(await findOperation(database, input.operationId), input);
  if (afterStateRead) return afterStateRead;
  const nextStatus = targetStatus(input.action);
  if (current.status === nextStatus) return { status: "conflict", reason: "already_in_state" };
  if (!transitionAllowed(current.status, input.action)) {
    return { status: "conflict", reason: "invalid_transition" };
  }

  try {
    const updated = await database.prepare(`UPDATE hub_ad_campaigns
      SET status=?,delivery_reason=?,delivery_audit_id=?,delivery_changed_at=?,
        delivery_version=delivery_version+1,updated_at=?
      WHERE id=? AND status=? AND delivery_version=?`)
      .bind(nextStatus, input.reason, input.operationId, now, now,
        input.campaignId, current.status, current.deliveryVersion).run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, input.operationId);
      if (!row) throw new Error("hub_ad_campaign_delivery_receipt_missing");
      return { status: "changed", receipt: receipt(row, false) };
    }
  } catch (error) {
    const concurrent = replayResult(await findOperation(database, input.operationId), input);
    if (concurrent) return concurrent;
    if (input.action === "activate" && error instanceof Error && error.message.includes("hub_ad_campaign_not_ready")) {
      return { status: "conflict", reason: "not_ready" };
    }
  }

  const committedWhileUpdating = replayResult(await findOperation(database, input.operationId), input);
  if (committedWhileUpdating) return committedWhileUpdating;
  return { status: "conflict", reason: "state_changed" };
}
