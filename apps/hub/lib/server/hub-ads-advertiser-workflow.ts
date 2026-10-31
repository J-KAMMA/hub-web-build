import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { HubAdFormat } from "@/lib/hub-ads";
import { inspectHubAdCreative, type HubAdPreflightCheck } from "@/lib/hub-ads-preflight";
import {
  hubAdCreativeContentHash,
  parseHubAdCampaignInput,
  parseHubAdCreativeInput,
  parseHubAdLineItemInput,
  type HubAdCampaignInput,
  type HubAdCreativeInput,
  type HubAdLineItemInput,
} from "@/lib/server/hub-ads-campaign-admin";

type WizardBody = Record<string, unknown>;
type PlacementSnapshot = { id: string; format: HubAdFormat; floor: number; targetingAllowedJson: string };

export type PreparedHubAdWizardSubmission = {
  advertiserRef: string;
  campaign: HubAdCampaignInput;
  creative: HubAdCreativeInput;
  lineItem: HubAdLineItemInput;
  placements: PlacementSnapshot[];
  imagePath: string | null;
  preflight: { passed: true; checks: HubAdPreflightCheck[] };
};

export type HubAdWizardPreparationResult =
  | { prepared: PreparedHubAdWizardSubmission }
  | { error: "invalid_placements" | "invalid_creative" | "preflight_failed" | "invalid_campaign" | "invalid_delivery"; preflight?: ReturnType<typeof inspectHubAdCreative> };

export async function prepareHubAdWizardSubmission(
  database: D1Database,
  advertiserRef: string,
  body: WizardBody,
): Promise<HubAdWizardPreparationResult> {
  const requestedIds = Array.isArray(body.placementIds)
    ? body.placementIds.filter((item): item is string => typeof item === "string")
    : [];
  if (!requestedIds.length || new Set(requestedIds).size !== requestedIds.length) return { error: "invalid_placements" };
  const placementIds = [...requestedIds].sort();
  const placements = await database.prepare(`SELECT id,format,floor_price_jpy_micros floor,
      targeting_allowed_json targetingAllowedJson
    FROM hub_ad_placements WHERE id IN (${placementIds.map(() => "?").join(",")}) AND status='active'`)
    .bind(...placementIds).all<PlacementSnapshot>();
  placements.results.sort((a, b) => a.id.localeCompare(b.id));
  if (placements.results.length !== placementIds.length
    || new Set(placements.results.map((item) => item.format)).size !== 1) return { error: "invalid_placements" };

  const format = placements.results[0]?.format;
  const creative = parseHubAdCreativeInput({ ...body, advertiserRef, format, language: body.language ?? "ja" });
  if (!creative) return { error: "invalid_creative" };
  let imagePath: string | null = null;
  if (creative.format === "static_display") {
    const asset = await database.prepare(`SELECT id FROM hub_ad_image_assets WHERE id=? AND advertiser_ref=?
      AND status='clean' AND structural_result='passed' AND scanner_result='clean'`)
      .bind(creative.assetId, advertiserRef).first<{ id: string }>();
    if (!asset) return { error: "invalid_creative" };
    imagePath = `/api/ads/assets/${asset.id}`;
  }
  const inspected = inspectHubAdCreative(creative);
  if (!inspected.passed) return { error: "preflight_failed", preflight: inspected };
  const campaign = parseHubAdCampaignInput({ ...body, advertiserRef, pricingModel: "viewable_cpm" });
  if (!campaign) return { error: "invalid_campaign" };
  const rate = Math.max(...placements.results.map((item) => Number(item.floor) || 0), 1);
  const lineItem = parseHubAdLineItemInput({
    name: `${campaign.campaignName} 配信`, placementIds, targetingRules: {}, pricingModel: "viewable_cpm",
    rateJpyMicros: rate, budgetJpyMicros: campaign.totalBudgetJpyMicros,
    dailyBudgetJpyMicros: campaign.dailyBudgetJpyMicros, startAt: campaign.startAt, endAt: campaign.endAt,
    priority: 0, pacingMode: "even",
  });
  if (!lineItem) return { error: "invalid_delivery" };
  return { prepared: {
    advertiserRef, campaign, creative, lineItem, placements: placements.results, imagePath,
    preflight: { passed: true, checks: inspected.checks },
  } };
}

function audit(database: D1Database, actorKey: string, action: string, targetType: string, targetId: string, after: unknown, now: number) {
  return database.prepare(`INSERT INTO hub_ad_audit_logs
    (id,actor_key,action,target_type,target_id,after_json,occurred_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), actorKey, action, targetType, targetId, JSON.stringify(after), now);
}

export async function commitHubAdWizardSubmission(
  database: D1Database,
  prepared: PreparedHubAdWizardSubmission,
  reservation: { scope: string; key: string; executionToken: string },
  now = Date.now(),
) {
  const campaignId = crypto.randomUUID();
  const creativeId = crypto.randomUUID();
  const creativeVersionId = crypto.randomUUID();
  const lineItemId = crypto.randomUUID();
  const actorKey = `advertiser:${prepared.advertiserRef}`;
  const response = { campaignId, lineItemId, creativeId, creativeVersionId,
    placementCount: prepared.placements.length, preflight: prepared.preflight };
  const responseJson = JSON.stringify(response);
  const statements = [
    database.prepare(`INSERT INTO hub_ad_campaigns
      (id,advertiser_ref,campaign_name,objective,pricing_model,currency,total_budget_jpy_micros,
       daily_budget_jpy_micros,start_at,end_at,timezone,status,review_status,created_by_actor_key,created_at,updated_at)
      SELECT ?,a.advertiser_ref,?,?,?,'JPY',?,?,?,?,'Asia/Tokyo','draft','pending',?,?,?
      FROM hub_ad_advertisers a
      JOIN hub_ad_admin_idempotency i
        ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      WHERE a.advertiser_ref=? AND a.status='active' AND a.policy_version IS NOT NULL`)
      .bind(campaignId, prepared.campaign.campaignName, prepared.campaign.objective, prepared.campaign.pricingModel,
        prepared.campaign.totalBudgetJpyMicros, prepared.campaign.dailyBudgetJpyMicros ?? null,
        prepared.campaign.startAt, prepared.campaign.endAt, actorKey, now, now,
        reservation.scope, reservation.key, reservation.executionToken, prepared.advertiserRef),
    database.prepare(`INSERT INTO hub_ad_creatives
      (id,advertiser_ref,format,status,current_version,created_at,updated_at)
      SELECT ?,c.advertiser_ref,?,'pending_review',1,?,? FROM hub_ad_campaigns c
      WHERE c.id=? AND c.advertiser_ref=? AND (
        ? IS NULL OR EXISTS (SELECT 1 FROM hub_ad_image_assets ia WHERE ia.id=? AND ia.advertiser_ref=c.advertiser_ref
          AND ia.status='clean' AND ia.structural_result='passed' AND ia.scanner_result='clean')
      )`)
      .bind(creativeId, prepared.creative.format, now, now, campaignId, prepared.advertiserRef,
        prepared.creative.assetId ?? null, prepared.creative.assetId ?? null),
    database.prepare(`INSERT INTO hub_ad_creative_versions
      (id,creative_id,version,headline,description,image_asset_path,alt_text,call_to_action,landing_url,
       display_url,advertiser_display_name,language,content_hash,review_status,created_at)
      VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?,'pending',?)`)
      .bind(creativeVersionId, creativeId, prepared.creative.headline, prepared.creative.description,
        prepared.imagePath, prepared.creative.altText, prepared.creative.callToAction, prepared.creative.landingUrl,
        prepared.creative.displayUrl, prepared.creative.advertiserDisplayName, prepared.creative.language,
        hubAdCreativeContentHash(prepared.creative, 1), now),
    database.prepare(`INSERT INTO hub_ad_line_items
      (id,campaign_id,name,targeting_rules_json,pricing_model,rate_jpy_micros,budget_jpy_micros,
       daily_budget_jpy_micros,start_at,end_at,priority,pacing_mode,frequency_cap_count,
       frequency_cap_window_seconds,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`)
      .bind(lineItemId, campaignId, prepared.lineItem.name, JSON.stringify(prepared.lineItem.targetingRules),
        prepared.lineItem.pricingModel, prepared.lineItem.rateJpyMicros, prepared.lineItem.budgetJpyMicros,
        prepared.lineItem.dailyBudgetJpyMicros ?? null, prepared.lineItem.startAt, prepared.lineItem.endAt,
        prepared.lineItem.priority, prepared.lineItem.pacingMode, prepared.lineItem.frequencyCapCount ?? null,
        prepared.lineItem.frequencyCapWindowSeconds ?? null, now, now),
    ...prepared.placements.map((placement) => database.prepare(`INSERT INTO hub_ad_line_item_placements(line_item_id,placement_id)
      SELECT ?,p.id FROM hub_ad_placements p WHERE p.id=? AND p.status='active' AND p.format=?
        AND p.floor_price_jpy_micros=? AND p.targeting_allowed_json=?`)
      .bind(lineItemId, placement.id, placement.format, placement.floor, placement.targetingAllowedJson)),
    database.prepare("INSERT INTO hub_ad_line_item_creatives(line_item_id,creative_version_id) VALUES(?,?)")
      .bind(lineItemId, creativeVersionId),
    database.prepare("UPDATE hub_ad_campaigns SET status='submitted',updated_at=? WHERE id=? AND status='draft'")
      .bind(now, campaignId),
    database.prepare(`INSERT INTO hub_ad_submission_checks
      (id,campaign_id,creative_version_id,checks_json,result,checked_at) VALUES(?,?,?,?,'passed',?)`)
      .bind(crypto.randomUUID(), campaignId, creativeVersionId, JSON.stringify(prepared.preflight.checks), now),
    audit(database, actorKey, "campaign.created", "campaign", campaignId, prepared.campaign, now),
    audit(database, actorKey, "creative.created", "creative", creativeId, { versionId: creativeVersionId, format: prepared.creative.format }, now),
    audit(database, actorKey, "line_item.created", "line_item", lineItemId, { campaignId, ...prepared.lineItem }, now),
    audit(database, actorKey, "creative.attached", "line_item", lineItemId, { creativeId, creativeVersionId }, now),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(responseJson, now, reservation.scope, reservation.key, reservation.executionToken),
  ];
  const results = await database.batch(statements);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) throw new Error("hub_ad_wizard_atomic_commit_unconfirmed");
  return response;
}
