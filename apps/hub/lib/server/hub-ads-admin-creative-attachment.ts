import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

const ATTACHABLE_CAMPAIGN_STATUSES = new Set([
  "draft", "submitted", "under_review", "needs_changes", "approved", "scheduled", "paused",
]);
const ATTACHABLE_LINE_ITEM_STATUSES = new Set(["draft", "paused"]);
const ATTACHABLE_CREATIVE_STATUSES = new Set(["pending_review", "approved", "paused"]);

export type HubAdAdminCreativeAttachmentConflict =
  | "line_item_unavailable"
  | "creative_unavailable"
  | "advertiser_mismatch"
  | "placement_format_mismatch"
  | "already_attached";

export type PreparedHubAdAdminCreativeAttachment = {
  lineItemId: string;
  creativeId: string;
  creativeVersionId: string;
  version: number;
  advertiserRef: string;
  format: string;
};

type AttachmentSnapshot = {
  lineItemId: string;
  lineItemStatus: string;
  campaignStatus: string;
  campaignAdvertiserRef: string;
  creativeId: string | null;
  creativeStatus: string | null;
  creativeAdvertiserRef: string | null;
  format: string | null;
  version: number | null;
  creativeVersionId: string | null;
  placementCount: number;
  mismatchedPlacementCount: number;
  existingAttachmentCount: number;
};

export async function prepareHubAdAdminCreativeAttachment(
  database: D1Database,
  lineItemId: string,
  creativeId: string,
): Promise<
  | { kind: "prepared"; value: PreparedHubAdAdminCreativeAttachment }
  | { kind: "conflict"; reason: HubAdAdminCreativeAttachmentConflict }
> {
  const row = await database.prepare(`SELECT li.id lineItemId,li.status lineItemStatus,c.status campaignStatus,
      c.advertiser_ref campaignAdvertiserRef,cr.id creativeId,cr.status creativeStatus,
      cr.advertiser_ref creativeAdvertiserRef,cr.format,cr.current_version version,cv.id creativeVersionId,
      (SELECT COUNT(*) FROM hub_ad_line_item_placements lip WHERE lip.line_item_id=li.id) placementCount,
      (SELECT COUNT(*) FROM hub_ad_line_item_placements lip JOIN hub_ad_placements p ON p.id=lip.placement_id
        WHERE lip.line_item_id=li.id AND p.format<>cr.format) mismatchedPlacementCount,
      (SELECT COUNT(*) FROM hub_ad_line_item_creatives lic
        JOIN hub_ad_creative_versions attached ON attached.id=lic.creative_version_id
        WHERE lic.line_item_id=li.id AND attached.creative_id=cr.id) existingAttachmentCount
    FROM hub_ad_line_items li JOIN hub_ad_campaigns c ON c.id=li.campaign_id
    LEFT JOIN hub_ad_creatives cr ON cr.id=?
    LEFT JOIN hub_ad_creative_versions cv ON cv.creative_id=cr.id AND cv.version=cr.current_version
    WHERE li.id=?`)
    .bind(creativeId, lineItemId).first<AttachmentSnapshot>();
  if (!row || !ATTACHABLE_LINE_ITEM_STATUSES.has(row.lineItemStatus)
    || !ATTACHABLE_CAMPAIGN_STATUSES.has(row.campaignStatus)) {
    return { kind: "conflict", reason: "line_item_unavailable" };
  }
  if (!row.creativeId || !row.creativeVersionId || row.version === null || !row.creativeStatus
    || !ATTACHABLE_CREATIVE_STATUSES.has(row.creativeStatus)) {
    return { kind: "conflict", reason: "creative_unavailable" };
  }
  if (row.campaignAdvertiserRef !== row.creativeAdvertiserRef) {
    return { kind: "conflict", reason: "advertiser_mismatch" };
  }
  if (row.placementCount < 1 || row.mismatchedPlacementCount > 0 || !row.format) {
    return { kind: "conflict", reason: "placement_format_mismatch" };
  }
  if (row.existingAttachmentCount > 0) return { kind: "conflict", reason: "already_attached" };
  return { kind: "prepared", value: {
    lineItemId: row.lineItemId,
    creativeId: row.creativeId,
    creativeVersionId: row.creativeVersionId,
    version: row.version,
    advertiserRef: row.creativeAdvertiserRef!,
    format: row.format,
  } };
}

export async function attachHubAdAdminCreativeAtomically(
  database: D1Database,
  prepared: PreparedHubAdAdminCreativeAttachment,
  reservation: { scope: string; key: string; executionToken: string },
  now = Date.now(),
) {
  const auditId = reservation.executionToken;
  const body = {
    attached: true as const,
    lineItemId: prepared.lineItemId,
    creativeId: prepared.creativeId,
    creativeVersionId: prepared.creativeVersionId,
    version: prepared.version,
    auditId,
    attachedAt: now,
  };
  const after = {
    creativeId: prepared.creativeId,
    creativeVersionId: prepared.creativeVersionId,
    version: prepared.version,
    advertiserRef: prepared.advertiserRef,
    format: prepared.format,
  };
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_line_item_creatives(line_item_id,creative_version_id)
      SELECT li.id,cv.id
      FROM hub_ad_line_items li JOIN hub_ad_campaigns c ON c.id=li.campaign_id
      JOIN hub_ad_creatives cr ON cr.id=?
      JOIN hub_ad_creative_versions cv ON cv.creative_id=cr.id AND cv.version=cr.current_version
      JOIN hub_ad_admin_idempotency i
        ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      WHERE li.id=? AND li.status IN ('draft','paused')
        AND c.status IN ('draft','submitted','under_review','needs_changes','approved','scheduled','paused')
        AND c.advertiser_ref=cr.advertiser_ref
        AND cr.status IN ('pending_review','approved','paused')
        AND cr.current_version=? AND cv.id=? AND cr.advertiser_ref=? AND cr.format=?
        AND EXISTS(SELECT 1 FROM hub_ad_line_item_placements lip WHERE lip.line_item_id=li.id)
        AND NOT EXISTS(SELECT 1 FROM hub_ad_line_item_placements lip
          JOIN hub_ad_placements p ON p.id=lip.placement_id
          WHERE lip.line_item_id=li.id AND p.format<>cr.format)
        AND NOT EXISTS(SELECT 1 FROM hub_ad_line_item_creatives lic
          JOIN hub_ad_creative_versions attached ON attached.id=lic.creative_version_id
          WHERE lic.line_item_id=li.id AND attached.creative_id=cr.id)`)
      .bind(prepared.creativeId, reservation.scope, reservation.key, reservation.executionToken,
        prepared.lineItemId, prepared.version, prepared.creativeVersionId,
        prepared.advertiserRef, prepared.format),
    database.prepare(`INSERT INTO hub_ad_audit_logs(
        id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at
      )
      SELECT ?,'moderation-admin','creative.attached','line_item',li.id,NULL,?,?
      FROM hub_ad_line_items li JOIN hub_ad_line_item_creatives lic ON lic.line_item_id=li.id
      JOIN hub_ad_admin_idempotency i
        ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      WHERE li.id=? AND lic.creative_version_id=?`)
      .bind(auditId, JSON.stringify(after), now,
        reservation.scope, reservation.key, reservation.executionToken,
        prepared.lineItemId, prepared.creativeVersionId),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=200,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_admin_creative_attachment_atomic_commit_unconfirmed");
  }
  return body;
}
