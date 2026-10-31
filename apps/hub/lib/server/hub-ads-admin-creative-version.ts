import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import {
  hubAdCreativeContentHash,
  type HubAdCreativeInput,
} from "@/lib/server/hub-ads-campaign-admin";
import type { HubAdFormat } from "@/lib/hub-ads";

export type PreparedHubAdAdminCreativeVersion = {
  creativeId: string;
  advertiserRef: string;
  format: HubAdFormat;
  expectedVersion: number;
  expectedVersionId: string;
};

type PreparationRow = PreparedHubAdAdminCreativeVersion & {
  creativeStatus: string;
  assetReady: number;
};

export async function prepareHubAdAdminCreativeVersion(
  database: D1Database,
  creativeId: string,
  input: HubAdCreativeInput,
): Promise<
  | { kind: "prepared"; value: PreparedHubAdAdminCreativeVersion }
  | { kind: "conflict"; reason: "creative_not_versionable" | "image_asset_unavailable" }
> {
  const row = await database.prepare(`SELECT cr.id creativeId,cr.advertiser_ref advertiserRef,cr.format,
      cr.status creativeStatus,cr.current_version expectedVersion,current.id expectedVersionId,
      CASE WHEN ?<>'static_display' THEN 1 ELSE EXISTS(
        SELECT 1 FROM hub_ad_image_assets ia
        WHERE ia.id=? AND ia.advertiser_ref=cr.advertiser_ref
          AND ia.status='clean' AND ia.structural_result='passed' AND ia.scanner_result='clean'
      ) END assetReady
    FROM hub_ad_creatives cr
    JOIN hub_ad_creative_versions current
      ON current.creative_id=cr.id AND current.version=cr.current_version
    WHERE cr.id=?`)
    .bind(input.format, input.assetId ?? null, creativeId).first<PreparationRow>();
  if (!row || row.creativeStatus === "archived"
    || row.advertiserRef !== input.advertiserRef || row.format !== input.format) {
    return { kind: "conflict", reason: "creative_not_versionable" };
  }
  if (!row.assetReady) return { kind: "conflict", reason: "image_asset_unavailable" };
  return { kind: "prepared", value: {
    creativeId: row.creativeId,
    advertiserRef: row.advertiserRef,
    format: row.format,
    expectedVersion: row.expectedVersion,
    expectedVersionId: row.expectedVersionId,
  } };
}

export async function createHubAdAdminCreativeVersionAtomically(
  database: D1Database,
  prepared: PreparedHubAdAdminCreativeVersion,
  input: HubAdCreativeInput,
  reservation: { scope: string; key: string; executionToken: string },
  versionId = crypto.randomUUID(),
  now = Date.now(),
) {
  const version = prepared.expectedVersion + 1;
  const imagePath = input.format === "static_display" ? `/api/ads/assets/${input.assetId}` : null;
  const auditId = reservation.executionToken;
  const body = {
    creativeId: prepared.creativeId,
    versionId,
    version,
    previousVersionId: prepared.expectedVersionId,
    previousVersion: prepared.expectedVersion,
    auditId,
    createdAt: now,
  };
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_creative_versions(
        id,creative_id,version,headline,description,image_asset_path,alt_text,call_to_action,landing_url,
        display_url,advertiser_display_name,language,content_hash,review_status,created_at
      )
      SELECT ?,cr.id,?,?,?,?,?,?,?,?,?,?,?,'pending',?
      FROM hub_ad_creatives cr
      JOIN hub_ad_creative_versions current
        ON current.creative_id=cr.id AND current.version=cr.current_version
      JOIN hub_ad_admin_idempotency i
        ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      WHERE cr.id=? AND cr.advertiser_ref=? AND cr.format=? AND cr.status<>'archived'
        AND cr.current_version=? AND current.id=?
        AND (? IS NULL OR EXISTS(
          SELECT 1 FROM hub_ad_image_assets ia
          WHERE ia.id=? AND ia.advertiser_ref=cr.advertiser_ref
            AND ia.status='clean' AND ia.structural_result='passed' AND ia.scanner_result='clean'
        ))`)
      .bind(versionId, version, input.headline, input.description, imagePath, input.altText,
        input.callToAction, input.landingUrl, input.displayUrl, input.advertiserDisplayName,
        input.language, hubAdCreativeContentHash(input, version), now,
        reservation.scope, reservation.key, reservation.executionToken, prepared.creativeId,
        prepared.advertiserRef, prepared.format, prepared.expectedVersion, prepared.expectedVersionId,
        input.assetId ?? null, input.assetId ?? null),
    database.prepare(`UPDATE hub_ad_creatives AS cr
      SET current_version=?,status='pending_review',updated_at=?
      WHERE cr.id=? AND cr.advertiser_ref=? AND cr.format=? AND cr.status<>'archived'
        AND cr.current_version=?
        AND EXISTS(SELECT 1 FROM hub_ad_creative_versions cv
          WHERE cv.id=? AND cv.creative_id=cr.id AND cv.version=?)`)
      .bind(version, now, prepared.creativeId, prepared.advertiserRef, prepared.format,
        prepared.expectedVersion, versionId, version),
    database.prepare(`UPDATE hub_ad_line_item_creatives SET creative_version_id=?
      WHERE creative_version_id=?`).bind(versionId, prepared.expectedVersionId),
    database.prepare(`INSERT INTO hub_ad_audit_logs(
        id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at
      )
      SELECT ?,'moderation-admin','creative.version_created','creative',cr.id,?,?,?
      FROM hub_ad_creatives cr
      WHERE cr.id=? AND cr.advertiser_ref=? AND cr.current_version=?
        AND EXISTS(SELECT 1 FROM hub_ad_creative_versions cv
          WHERE cv.id=? AND cv.creative_id=cr.id AND cv.version=?)`)
      .bind(auditId,
        JSON.stringify({ versionId: prepared.expectedVersionId, version: prepared.expectedVersion }),
        JSON.stringify({ versionId, version, status: "pending_review" }), now,
        prepared.creativeId, prepared.advertiserRef, version, versionId, version),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ]);
  for (const index of [0, 1, 3, 4]) {
    if ((results[index]?.meta.changes ?? 0) !== 1) {
      throw new Error("hub_ad_admin_creative_version_atomic_commit_unconfirmed");
    }
  }
  return body;
}
