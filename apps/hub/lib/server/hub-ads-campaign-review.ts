import type { D1Database } from "@cloudflare/workers-types";

export type HubAdCampaignReviewStatus =
  | "pending"
  | "approved"
  | "approved_with_restrictions"
  | "needs_changes"
  | "rejected"
  | "escalated";
export type HubAdCampaignReviewDecision = "approved" | "needs_changes" | "rejected";

export type HubAdCampaignReviewReceipt = {
  auditId: string;
  action: "campaign.reviewed";
  targetId: string;
  fromStatus: string;
  fromReviewStatus: HubAdCampaignReviewStatus;
  toStatus: HubAdCampaignReviewDecision;
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdCampaignReviewResult =
  | { status: "reviewed" | "replayed"; receipt: HubAdCampaignReviewReceipt }
  | { status: "not_found" }
  | { status: "conflict"; reason: "operation_id_reused" | "already_in_state" | "invalid_transition" | "state_changed" };

type CampaignRow = {
  status: string;
  reviewStatus: HubAdCampaignReviewStatus;
};

type ReviewAuditRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  fromStatus: string;
  fromReviewStatus: HubAdCampaignReviewStatus;
  decision: HubAdCampaignReviewDecision;
  reason: string;
  occurredAt: number;
};

async function findOperation(database: D1Database, operationId: string) {
  return database.prepare(`SELECT id,action,target_type targetType,target_id targetId,
      json_extract(before_json,'$.status') fromStatus,
      json_extract(before_json,'$.reviewStatus') fromReviewStatus,
      json_extract(after_json,'$.decision') decision,
      json_extract(after_json,'$.reason') reason,occurred_at occurredAt
    FROM hub_ad_audit_logs WHERE id=? LIMIT 1`)
    .bind(operationId).first<ReviewAuditRow>();
}

function receipt(row: ReviewAuditRow, replayed: boolean): HubAdCampaignReviewReceipt {
  return {
    auditId: row.id,
    action: "campaign.reviewed",
    targetId: row.targetId,
    fromStatus: row.fromStatus,
    fromReviewStatus: row.fromReviewStatus,
    toStatus: row.decision,
    confirmedAt: row.occurredAt,
    replayed,
  };
}

function replayResult(
  row: ReviewAuditRow | null,
  input: { campaignId: string; decision: HubAdCampaignReviewDecision; reason: string },
): HubAdCampaignReviewResult | null {
  if (!row) return null;
  if (
    row.action !== "campaign.reviewed"
    || row.targetType !== "campaign"
    || row.targetId !== input.campaignId
    || row.decision !== input.decision
    || row.reason !== input.reason
  ) return { status: "conflict", reason: "operation_id_reused" };
  return { status: "replayed", receipt: receipt(row, true) };
}

function transitionAllowed(campaign: CampaignRow) {
  if (campaign.reviewStatus === "needs_changes") return campaign.status === "needs_changes";
  if (campaign.reviewStatus === "pending" || campaign.reviewStatus === "escalated") {
    return ["draft", "submitted", "under_review", "needs_changes"].includes(campaign.status);
  }
  return false;
}

export async function reviewHubAdCampaign(
  database: D1Database,
  rawInput: { campaignId: string; operationId: string; decision: HubAdCampaignReviewDecision; reason: string },
  now = Date.now(),
): Promise<HubAdCampaignReviewResult> {
  const input = { ...rawInput, reason: rawInput.reason.trim() };
  const existing = replayResult(await findOperation(database, input.operationId), input);
  if (existing) return existing;

  const campaign = await database.prepare(`SELECT status,review_status reviewStatus
    FROM hub_ad_campaigns WHERE id=?`).bind(input.campaignId).first<CampaignRow>();
  if (!campaign) return { status: "not_found" };
  const afterStateRead = replayResult(await findOperation(database, input.operationId), input);
  if (afterStateRead) return afterStateRead;
  if (campaign.reviewStatus === input.decision) return { status: "conflict", reason: "already_in_state" };
  if (!transitionAllowed(campaign)) return { status: "conflict", reason: "invalid_transition" };

  try {
    const updated = await database.prepare(`UPDATE hub_ad_campaigns
      SET review_status=?,status=?,review_reason=?,review_audit_id=?,reviewed_at=?,updated_at=?
      WHERE id=? AND review_status=? AND status=?`)
      .bind(input.decision, input.decision, input.reason, input.operationId, now, now,
        input.campaignId, campaign.reviewStatus, campaign.status)
      .run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, input.operationId);
      if (!row) throw new Error("hub_ad_campaign_review_receipt_missing");
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
