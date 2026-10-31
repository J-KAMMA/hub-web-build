import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import {
  hubAdCreativeContentHash,
  type HubAdCreativeInput,
} from "@/lib/server/hub-ads-campaign-admin";

export async function prepareHubAdAdminCreativeCreation(
  database: D1Database,
  input: HubAdCreativeInput,
): Promise<{ kind: "prepared" } | { kind: "conflict"; reason: "image_asset_unavailable" }> {
  if (input.format !== "static_display") return { kind: "prepared" };
  const asset = await database.prepare(`SELECT 1 ok FROM hub_ad_image_assets
    WHERE id=? AND advertiser_ref=?
      AND status='clean' AND structural_result='passed' AND scanner_result='clean'`)
    .bind(input.assetId, input.advertiserRef).first<{ ok: number }>();
  return asset ? { kind: "prepared" } : { kind: "conflict", reason: "image_asset_unavailable" };
}

export async function createHubAdAdminCreativeAtomically(
  database: D1Database,
  input: HubAdCreativeInput,
  reservation: { scope: string; key: string; executionToken: string },
  ids: { creativeId: string; versionId: string } = {
    creativeId: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
  },
  now = Date.now(),
) {
  const imagePath = input.format === "static_display" ? `/api/ads/assets/${input.assetId}` : null;
  const auditId = reservation.executionToken;
  const body = {
    creativeId: ids.creativeId,
    versionId: ids.versionId,
    version: 1 as const,
    advertiserRef: input.advertiserRef,
    format: input.format,
    auditId,
    createdAt: now,
  };
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_creatives(
        id,advertiser_ref,format,status,current_version,created_at,updated_at
      )
      SELECT ?,?,?, 'pending_review',1,?,?
      FROM hub_ad_admin_idempotency i
      WHERE i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
        AND (? IS NULL OR EXISTS(
          SELECT 1 FROM hub_ad_image_assets ia
          WHERE ia.id=? AND ia.advertiser_ref=?
            AND ia.status='clean' AND ia.structural_result='passed' AND ia.scanner_result='clean'
        ))`)
      .bind(ids.creativeId, input.advertiserRef, input.format, now, now,
        reservation.scope, reservation.key, reservation.executionToken,
        input.assetId ?? null, input.assetId ?? null, input.advertiserRef),
    database.prepare(`INSERT INTO hub_ad_creative_versions(
        id,creative_id,version,headline,description,image_asset_path,alt_text,call_to_action,landing_url,
        display_url,advertiser_display_name,language,content_hash,review_status,created_at
      )
      SELECT ?,cr.id,1,?,?,?,?,?,?,?,?,?,?,'pending',?
      FROM hub_ad_creatives cr
      WHERE cr.id=? AND cr.advertiser_ref=? AND cr.format=?
        AND cr.status='pending_review' AND cr.current_version=1`)
      .bind(ids.versionId, input.headline, input.description, imagePath, input.altText,
        input.callToAction, input.landingUrl, input.displayUrl, input.advertiserDisplayName,
        input.language, hubAdCreativeContentHash(input, 1), now,
        ids.creativeId, input.advertiserRef, input.format),
    database.prepare(`INSERT INTO hub_ad_audit_logs(
        id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at
      )
      SELECT ?,'moderation-admin','creative.created','creative',cr.id,NULL,?,?
      FROM hub_ad_creatives cr
      JOIN hub_ad_creative_versions cv ON cv.creative_id=cr.id AND cv.version=1
      WHERE cr.id=? AND cv.id=?`)
      .bind(auditId, JSON.stringify({ versionId: ids.versionId, version: 1,
        advertiserRef: input.advertiserRef, format: input.format, status: "pending_review" }),
      now, ids.creativeId, ids.versionId),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_admin_creative_atomic_create_unconfirmed");
  }
  return body;
}
