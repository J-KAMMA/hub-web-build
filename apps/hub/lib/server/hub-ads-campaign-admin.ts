import "server-only";

import { createHash } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";
import { HUB_AD_FORMATS, validateLandingUrl, validateTargetingRules, type HubAdFormat } from "@/lib/hub-ads";
import { HUB_AD_DEFAULT_FREQUENCY_CAP } from "@/lib/hub-ad-pricing";
import type { HubAdPreflightCheck } from "@/lib/hub-ads-preflight";

const OBJECTIVES = ["awareness", "website_visits", "product_service", "event", "sponsorship"] as const;
type CampaignObjective = (typeof OBJECTIVES)[number];
type PricingModel = "fixed_period" | "viewable_cpm";

export interface HubAdCampaignInput {
  advertiserRef: string;
  campaignName: string;
  objective: CampaignObjective;
  pricingModel: PricingModel;
  totalBudgetJpyMicros: number;
  dailyBudgetJpyMicros?: number;
  startAt: number;
  endAt: number;
}

export interface HubAdLineItemInput {
  name: string;
  placementIds: string[];
  targetingRules: Readonly<Record<string, unknown>>;
  pricingModel: PricingModel;
  rateJpyMicros: number;
  budgetJpyMicros: number;
  dailyBudgetJpyMicros?: number;
  startAt: number;
  endAt: number;
  priority: number;
  pacingMode: "even" | "asap";
  frequencyCapCount?: number;
  frequencyCapWindowSeconds?: number;
}

export interface HubAdCreativeInput {
  advertiserRef: string;
  format: HubAdFormat;
  assetId?: string;
  headline: string;
  description: string;
  altText: string;
  callToAction: string;
  landingUrl: string;
  displayUrl: string;
  advertiserDisplayName: string;
  language: string;
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const result = value.normalize("NFKC").trim();
  return (allowEmpty || result.length > 0) && result.length <= maximum ? result : null;
}

function safeMoney(value: unknown, allowZero = false): number | null {
  return Number.isSafeInteger(value) && Number(value) >= (allowZero ? 0 : 1) ? Number(value) : null;
}

function optionalMoney(value: unknown): number | undefined | null {
  return value === undefined || value === null ? undefined : safeMoney(value);
}

function validAdvertiserRef(value: unknown): value is string {
  return typeof value === "string" && /^adv_[a-z0-9]{16,64}$/.test(value);
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function parseHubAdCampaignInput(value: unknown): HubAdCampaignInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const campaignName = boundedText(body.campaignName, 160);
  const totalBudget = safeMoney(body.totalBudgetJpyMicros);
  const dailyBudget = optionalMoney(body.dailyBudgetJpyMicros);
  if (!validAdvertiserRef(body.advertiserRef) || !campaignName || !OBJECTIVES.includes(body.objective as CampaignObjective)
    || (body.pricingModel !== "fixed_period" && body.pricingModel !== "viewable_cpm") || totalBudget === null || dailyBudget === null
    || !validTimestamp(body.startAt) || !validTimestamp(body.endAt) || body.endAt <= body.startAt
    || body.endAt - body.startAt > 366 * 24 * 60 * 60 * 1000 || (dailyBudget !== undefined && dailyBudget > totalBudget)) return null;
  return { advertiserRef: body.advertiserRef, campaignName, objective: body.objective as CampaignObjective,
    pricingModel: body.pricingModel, totalBudgetJpyMicros: totalBudget, dailyBudgetJpyMicros: dailyBudget,
    startAt: body.startAt, endAt: body.endAt };
}

export function parseHubAdLineItemInput(value: unknown): HubAdLineItemInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const name = boundedText(body.name, 160);
  const rate = safeMoney(body.rateJpyMicros, true);
  const budget = safeMoney(body.budgetJpyMicros);
  const dailyBudget = optionalMoney(body.dailyBudgetJpyMicros);
  const requestedCapCount = body.frequencyCapCount === undefined || body.frequencyCapCount === null ? undefined : Number(body.frequencyCapCount);
  const requestedCapWindow = body.frequencyCapWindowSeconds === undefined || body.frequencyCapWindowSeconds === null ? undefined : Number(body.frequencyCapWindowSeconds);
  if (!name || !Array.isArray(body.placementIds) || body.placementIds.length < 1 || body.placementIds.length > 20
    || !body.placementIds.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(id))
    || !validateTargetingRules(body.targetingRules) || (body.pricingModel !== "fixed_period" && body.pricingModel !== "viewable_cpm")
    || rate === null || budget === null || dailyBudget === null || (dailyBudget !== undefined && dailyBudget > budget)
    || !validTimestamp(body.startAt) || !validTimestamp(body.endAt) || body.endAt <= body.startAt
    || !Number.isInteger(body.priority) || Number(body.priority) < -100 || Number(body.priority) > 100
    || (body.pacingMode !== "even" && body.pacingMode !== "asap")
    || (requestedCapCount !== undefined && (!Number.isInteger(requestedCapCount) || requestedCapCount < 1 || requestedCapCount > 100))
    || (requestedCapWindow !== undefined && (!Number.isInteger(requestedCapWindow) || requestedCapWindow < 60 || requestedCapWindow > 2_592_000))
    || (requestedCapCount === undefined) !== (requestedCapWindow === undefined)) return null;
  const capCount = requestedCapCount ?? (body.pricingModel === "viewable_cpm" ? HUB_AD_DEFAULT_FREQUENCY_CAP.count : undefined);
  const capWindow = requestedCapWindow ?? (body.pricingModel === "viewable_cpm" ? HUB_AD_DEFAULT_FREQUENCY_CAP.windowSeconds : undefined);
  return { name, placementIds: [...new Set(body.placementIds as string[])], targetingRules: body.targetingRules,
    pricingModel: body.pricingModel, rateJpyMicros: rate, budgetJpyMicros: budget, dailyBudgetJpyMicros: dailyBudget,
    startAt: body.startAt, endAt: body.endAt, priority: Number(body.priority), pacingMode: body.pacingMode,
    frequencyCapCount: capCount, frequencyCapWindowSeconds: capWindow };
}

export function parseHubAdCreativeInput(value: unknown): HubAdCreativeInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const headline = boundedText(body.headline, 120); const description = boundedText(body.description, 500, true);
  const altText = boundedText(body.altText, 300, true); const callToAction = boundedText(body.callToAction, 40);
  const advertiserDisplayName = boundedText(body.advertiserDisplayName, 120);
  const language = boundedText(body.language, 16); const landingUrl = typeof body.landingUrl === "string" ? validateLandingUrl(body.landingUrl)?.toString() : null;
  const assetId = typeof body.assetId === "string" && /^[0-9a-f-]{36}$/.test(body.assetId) ? body.assetId : undefined;
  if (!validAdvertiserRef(body.advertiserRef) || !HUB_AD_FORMATS.includes(body.format as HubAdFormat)
    || (body.format === "static_display") !== Boolean(assetId)
    || !headline || description === null || altText === null || !callToAction || !landingUrl
    || !advertiserDisplayName || !language || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)) return null;
  const displayUrl = new URL(landingUrl).hostname;
  return { advertiserRef: body.advertiserRef, format: body.format as HubAdCreativeInput["format"], assetId, headline, description,
    altText, callToAction, landingUrl, displayUrl, advertiserDisplayName, language };
}

export function hubAdCreativeContentHash(input: HubAdCreativeInput, version: number): string {
  return createHash("sha256").update(JSON.stringify({ ...input, version })).digest("hex");
}

function audit(database: D1Database, action: string, targetType: string, targetId: string, after: unknown, now: number) {
  return database.prepare(`INSERT INTO hub_ad_audit_logs
    (id, actor_key, action, target_type, target_id, after_json, occurred_at)
    VALUES (?, 'moderation-admin', ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), action, targetType, targetId, JSON.stringify(after), now);
}

export async function listHubAdCampaigns(database: D1Database) {
  return (await database.prepare(`SELECT c.id, c.advertiser_ref AS advertiserRef, c.campaign_name AS campaignName,
    c.objective, c.pricing_model AS pricingModel, c.total_budget_jpy_micros AS totalBudgetJpyMicros,
    c.daily_budget_jpy_micros AS dailyBudgetJpyMicros, c.start_at AS startAt, c.end_at AS endAt,
    c.status, c.review_status AS reviewStatus,
    (SELECT COUNT(*) FROM hub_ad_line_items li WHERE li.campaign_id = c.id) AS lineItemCount,
    COALESCE((SELECT SUM(x.credited_jpy_micros) FROM hub_ad_x402_deposits x WHERE x.campaign_id = c.id AND x.status = 'settled'), 0) AS fundedJpyMicros,
    (SELECT x.status FROM hub_ad_x402_deposits x WHERE x.campaign_id = c.id ORDER BY x.created_at DESC LIMIT 1) AS latestX402Status,
    (SELECT x.amount_usdc_atomic FROM hub_ad_x402_deposits x WHERE x.campaign_id = c.id ORDER BY x.created_at DESC LIMIT 1) AS latestX402AmountUsdcAtomic,
    (SELECT x.transaction_hash FROM hub_ad_x402_deposits x WHERE x.campaign_id = c.id ORDER BY x.created_at DESC LIMIT 1) AS latestX402TransactionHash,
    (SELECT x.settled_at FROM hub_ad_x402_deposits x WHERE x.campaign_id = c.id ORDER BY x.created_at DESC LIMIT 1) AS latestX402SettledAt,
    COALESCE((SELECT SUM(bl.amount_jpy_micros) FROM hub_ad_budget_ledger bl WHERE bl.campaign_id = c.id), 0) AS spentJpyMicros
    FROM hub_ad_campaigns c ORDER BY c.created_at DESC LIMIT 500`).all()).results;
}

export async function listHubAdCreatives(database: D1Database) {
  return (await database.prepare(`SELECT cr.id, cr.advertiser_ref AS advertiserRef, cr.format, cr.status,
    cr.current_version AS currentVersion, cv.id AS versionId, cv.headline, cv.advertiser_display_name AS advertiserDisplayName,
    cv.language, cv.review_status AS reviewStatus, cr.created_at AS createdAt, cr.updated_at AS updatedAt,
    (SELECT lc.result FROM hub_ad_landing_checks lc WHERE lc.creative_version_id = cv.id ORDER BY lc.checked_at DESC LIMIT 1) AS landingResult,
    (SELECT lc.reason_code FROM hub_ad_landing_checks lc WHERE lc.creative_version_id = cv.id ORDER BY lc.checked_at DESC LIMIT 1) AS landingReason,
    (SELECT lc.checked_at FROM hub_ad_landing_checks lc WHERE lc.creative_version_id = cv.id ORDER BY lc.checked_at DESC LIMIT 1) AS landingCheckedAt
    FROM hub_ad_creatives cr JOIN hub_ad_creative_versions cv ON cv.creative_id = cr.id AND cv.version = cr.current_version
    ORDER BY cr.updated_at DESC LIMIT 500`).all()).results;
}

export async function listHubAdLineItems(database: D1Database) {
  return (await database.prepare(`SELECT li.id, li.campaign_id AS campaignId, li.name, li.pricing_model AS pricingModel,
    li.rate_jpy_micros AS rateJpyMicros, li.budget_jpy_micros AS budgetJpyMicros, li.status,
    GROUP_CONCAT(lip.placement_id) AS placementIds,
    (SELECT COUNT(*) FROM hub_ad_line_item_creatives lic WHERE lic.line_item_id = li.id) AS creativeCount
    FROM hub_ad_line_items li LEFT JOIN hub_ad_line_item_placements lip ON lip.line_item_id = li.id
    GROUP BY li.id ORDER BY li.created_at DESC LIMIT 500`).all()).results;
}

export async function createHubAdCampaign(database: D1Database, input: HubAdCampaignInput, now = Date.now()) {
  const id = crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO hub_ad_campaigns
      (id, advertiser_ref, campaign_name, objective, pricing_model, currency, total_budget_jpy_micros,
       daily_budget_jpy_micros, start_at, end_at, timezone, status, review_status, created_by_actor_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'JPY', ?, ?, ?, ?, 'Asia/Tokyo', 'draft', 'pending', 'moderation-admin', ?, ?)`)
      .bind(id, input.advertiserRef, input.campaignName, input.objective, input.pricingModel, input.totalBudgetJpyMicros,
        input.dailyBudgetJpyMicros ?? null, input.startAt, input.endAt, now, now),
    audit(database, "campaign.created", "campaign", id, input, now),
  ]);
  return id;
}

export async function createHubAdCampaignAtomically(
  database: D1Database,
  input: HubAdCampaignInput,
  reservation: { scope: string; key: string; executionToken: string },
  now = Date.now(),
) {
  const id = crypto.randomUUID();
  const body = { id };
  const responseJson = JSON.stringify(body);
  const auditId = crypto.randomUUID();
  const results = await database.batch([
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(responseJson, now, reservation.scope, reservation.key, reservation.executionToken),
    database.prepare(`INSERT INTO hub_ad_campaigns
      (id, advertiser_ref, campaign_name, objective, pricing_model, currency, total_budget_jpy_micros,
       daily_budget_jpy_micros, start_at, end_at, timezone, status, review_status, created_by_actor_key, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, 'JPY', ?, ?, ?, ?, 'Asia/Tokyo', 'draft', 'pending', 'moderation-admin', ?, ?
      FROM hub_ad_admin_idempotency
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='completed'
        AND response_status=201 AND response_json=?`)
      .bind(id, input.advertiserRef, input.campaignName, input.objective, input.pricingModel,
        input.totalBudgetJpyMicros, input.dailyBudgetJpyMicros ?? null, input.startAt, input.endAt, now, now,
        reservation.scope, reservation.key, reservation.executionToken, responseJson),
    database.prepare(`INSERT INTO hub_ad_audit_logs
      (id, actor_key, action, target_type, target_id, after_json, occurred_at)
      SELECT ?, 'moderation-admin', 'campaign.created', 'campaign', c.id, ?, ?
      FROM hub_ad_campaigns c WHERE c.id=?`)
      .bind(auditId, JSON.stringify(input), now, id),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_campaign_atomic_create_unconfirmed");
  }
  return body;
}

export async function createHubAdvertiserCampaignAtomically(
  database: D1Database,
  input: HubAdCampaignInput,
  reservation: { scope: string; key: string; executionToken: string },
  now = Date.now(),
) {
  const id = crypto.randomUUID();
  const body = { id };
  const actorKey = `advertiser:${input.advertiserRef}`;
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_campaigns
      (id,advertiser_ref,campaign_name,objective,pricing_model,currency,total_budget_jpy_micros,
       daily_budget_jpy_micros,start_at,end_at,timezone,status,review_status,created_by_actor_key,created_at,updated_at)
      SELECT ?,a.advertiser_ref,?,?,?,'JPY',?,?,?,?,'Asia/Tokyo','draft','pending',?,?,?
      FROM hub_ad_advertisers a
      JOIN hub_ad_admin_idempotency i
        ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      WHERE a.advertiser_ref=? AND a.status='active' AND a.policy_version IS NOT NULL`)
      .bind(id, input.campaignName, input.objective, input.pricingModel, input.totalBudgetJpyMicros,
        input.dailyBudgetJpyMicros ?? null, input.startAt, input.endAt, actorKey, now, now,
        reservation.scope, reservation.key, reservation.executionToken, input.advertiserRef),
    database.prepare(`INSERT INTO hub_ad_audit_logs
      (id,actor_key,action,target_type,target_id,after_json,occurred_at)
      SELECT ?,?,'campaign.created','campaign',c.id,?,? FROM hub_ad_campaigns c
      WHERE c.id=? AND c.advertiser_ref=?`)
      .bind(crypto.randomUUID(), actorKey, JSON.stringify(input), now, id, input.advertiserRef),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_advertiser_campaign_atomic_create_unconfirmed");
  }
  return body;
}

interface CampaignRow { id: string; advertiser_ref: string; pricing_model: PricingModel; total_budget_jpy_micros: number;
  start_at: number; end_at: number; status: string; review_status: string }

export async function createHubAdLineItem(database: D1Database, campaignId: string, input: HubAdLineItemInput, now = Date.now()) {
  const campaign = await database.prepare(`SELECT id, advertiser_ref, pricing_model, total_budget_jpy_micros, start_at, end_at, status, review_status
    FROM hub_ad_campaigns WHERE id = ?`).bind(campaignId).first<CampaignRow>();
  if (!campaign || !["draft", "needs_changes", "approved"].includes(campaign.status) || campaign.pricing_model !== input.pricingModel
    || input.startAt < campaign.start_at || input.endAt > campaign.end_at || input.budgetJpyMicros > campaign.total_budget_jpy_micros) return null;
  const placeholders = input.placementIds.map(() => "?").join(",");
  const placements = await database.prepare(`SELECT id, format, floor_price_jpy_micros, targeting_allowed_json
    FROM hub_ad_placements WHERE id IN (${placeholders}) AND status != 'archived'`).bind(...input.placementIds)
    .all<{ id: string; format: HubAdFormat; floor_price_jpy_micros: number; targeting_allowed_json: string }>();
  if (placements.results.length !== input.placementIds.length || new Set(placements.results.map((item) => item.format)).size !== 1
    || placements.results.some((item) => input.rateJpyMicros < item.floor_price_jpy_micros)) return null;
  const targetingKeys = Object.keys(input.targetingRules).filter((key) => key !== "estimatedAudience" && key !== "estimatedMonthlyImpressions");
  if (placements.results.some((placement) => {
    try { const allowed = new Set(JSON.parse(placement.targeting_allowed_json) as string[]); return targetingKeys.some((key) => !allowed.has(key)); }
    catch { return true; }
  })) return null;
  const id = crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO hub_ad_line_items
      (id, campaign_id, name, targeting_rules_json, pricing_model, rate_jpy_micros, budget_jpy_micros,
       daily_budget_jpy_micros, start_at, end_at, priority, pacing_mode, frequency_cap_count,
       frequency_cap_window_seconds, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .bind(id, campaignId, input.name, JSON.stringify(input.targetingRules), input.pricingModel, input.rateJpyMicros,
        input.budgetJpyMicros, input.dailyBudgetJpyMicros ?? null, input.startAt, input.endAt, input.priority,
        input.pacingMode, input.frequencyCapCount ?? null, input.frequencyCapWindowSeconds ?? null, now, now),
    ...input.placementIds.map((placementId) => database.prepare(`INSERT INTO hub_ad_line_item_placements
      (line_item_id, placement_id) VALUES (?, ?)`).bind(id, placementId)),
    audit(database, "line_item.created", "line_item", id, { campaignId, ...input }, now),
  ]);
  return id;
}

export async function createHubAdCreative(database: D1Database, input: HubAdCreativeInput, now = Date.now()) {
  const imagePath = await resolveHubAdImageAssetPath(database, input); if (imagePath === undefined) return null;
  const creativeId = crypto.randomUUID(); const versionId = crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO hub_ad_creatives
      (id, advertiser_ref, format, status, current_version, created_at, updated_at)
      VALUES (?, ?, ?, 'pending_review', 1, ?, ?)`).bind(creativeId, input.advertiserRef, input.format, now, now),
    database.prepare(`INSERT INTO hub_ad_creative_versions
      (id, creative_id, version, headline, description, image_asset_path, alt_text, call_to_action, landing_url,
       display_url, advertiser_display_name, language, content_hash, review_status, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(versionId, creativeId, input.headline, input.description, imagePath, input.altText, input.callToAction, input.landingUrl,
        input.displayUrl, input.advertiserDisplayName, input.language, hubAdCreativeContentHash(input, 1), now),
    audit(database, "creative.created", "creative", creativeId, { versionId, format: input.format }, now),
  ]);
  return { creativeId, versionId, version: 1 };
}

// Compatibility path for the moderation-admin version endpoint. Advertiser
// resubmissions use the atomic, receipt-backed flow below.
export async function createHubAdCreativeVersion(
  database: D1Database,
  creativeId: string,
  input: HubAdCreativeInput,
  now = Date.now(),
) {
  const creative = await database.prepare(`SELECT advertiser_ref,format,current_version
      FROM hub_ad_creatives WHERE id=? AND status!='archived'`)
    .bind(creativeId).first<{ advertiser_ref: string; format: HubAdFormat; current_version: number }>();
  if (!creative || creative.advertiser_ref !== input.advertiserRef || creative.format !== input.format) return null;
  const imagePath = await resolveHubAdImageAssetPath(database, input);
  if (imagePath === undefined) return null;
  const version = creative.current_version + 1;
  const versionId = crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO hub_ad_creative_versions
      (id,creative_id,version,headline,description,image_asset_path,alt_text,call_to_action,landing_url,
       display_url,advertiser_display_name,language,content_hash,review_status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`)
      .bind(versionId, creativeId, version, input.headline, input.description, imagePath, input.altText,
        input.callToAction, input.landingUrl, input.displayUrl, input.advertiserDisplayName, input.language,
        hubAdCreativeContentHash(input, version), now),
    database.prepare(`UPDATE hub_ad_creatives SET current_version=?,status='pending_review',updated_at=? WHERE id=?`)
      .bind(version, now, creativeId),
    database.prepare(`INSERT OR IGNORE INTO hub_ad_line_item_creatives (line_item_id,creative_version_id)
      SELECT line_item_id,? FROM hub_ad_line_item_creatives WHERE creative_version_id IN
        (SELECT id FROM hub_ad_creative_versions WHERE creative_id=? AND version=?)`)
      .bind(versionId, creativeId, creative.current_version),
    audit(database, "creative.version_created", "creative", creativeId, { versionId, version }, now),
  ]);
  return { creativeId, versionId, version };
}

export async function createHubAdvertiserCreativeAtomically(
  database: D1Database,
  input: HubAdCreativeInput,
  reservation: { scope: string; key: string; executionToken: string },
  now = Date.now(),
) {
  const creativeId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const actorKey = `advertiser:${input.advertiserRef}`;
  const imagePath = input.format === "static_display" ? `/api/ads/assets/${input.assetId}` : null;
  const body = { creativeId, versionId, version: 1 };
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_creatives
      (id,advertiser_ref,format,status,current_version,created_at,updated_at)
      SELECT ?,a.advertiser_ref,?,'pending_review',1,?,?
      FROM hub_ad_advertisers a
      JOIN hub_ad_admin_idempotency i
        ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      WHERE a.advertiser_ref=? AND a.status='active' AND a.policy_version IS NOT NULL
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM hub_ad_image_assets ia
          WHERE ia.id=? AND ia.advertiser_ref=a.advertiser_ref
            AND ia.status='clean' AND ia.structural_result='passed' AND ia.scanner_result='clean'
        ))`)
      .bind(creativeId, input.format, now, now, reservation.scope, reservation.key,
        reservation.executionToken, input.advertiserRef, input.assetId ?? null, input.assetId ?? null),
    database.prepare(`INSERT INTO hub_ad_creative_versions
      (id,creative_id,version,headline,description,image_asset_path,alt_text,call_to_action,landing_url,
       display_url,advertiser_display_name,language,content_hash,review_status,created_at)
      VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?,'pending',?)`)
      .bind(versionId, creativeId, input.headline, input.description, imagePath, input.altText, input.callToAction,
        input.landingUrl, input.displayUrl, input.advertiserDisplayName, input.language,
        hubAdCreativeContentHash(input, 1), now),
    database.prepare(`INSERT INTO hub_ad_audit_logs
      (id,actor_key,action,target_type,target_id,after_json,occurred_at)
      SELECT ?,?,'creative.created','creative',cr.id,?,? FROM hub_ad_creatives cr
      WHERE cr.id=? AND cr.advertiser_ref=?`)
      .bind(crypto.randomUUID(), actorKey, JSON.stringify({ versionId, format: input.format }),
        now, creativeId, input.advertiserRef),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_advertiser_creative_atomic_create_unconfirmed");
  }
  return body;
}

export type PreparedHubAdCreativeResubmission = {
  creativeId: string;
  advertiserRef: string;
  format: HubAdFormat;
  expectedVersion: number;
  expectedVersionId: string;
};

export async function prepareHubAdCreativeResubmission(
  database: D1Database,
  creativeId: string,
  advertiserRef: string,
): Promise<PreparedHubAdCreativeResubmission | null> {
  return database.prepare(`SELECT cr.id creativeId,cr.advertiser_ref advertiserRef,cr.format,
      cr.current_version expectedVersion,cv.id expectedVersionId
    FROM hub_ad_creatives cr
    JOIN hub_ad_creative_versions cv ON cv.creative_id=cr.id AND cv.version=cr.current_version
    WHERE cr.id=? AND cr.advertiser_ref=? AND cr.status IN ('pending_review','rejected')
      AND cv.review_status IN ('needs_changes','rejected')`)
    .bind(creativeId, advertiserRef).first<PreparedHubAdCreativeResubmission>();
}

export async function resubmitHubAdCreativeAtomically(
  database: D1Database,
  prepared: PreparedHubAdCreativeResubmission,
  input: HubAdCreativeInput,
  preflight: { passed: true; checks: HubAdPreflightCheck[] },
  reservation: { scope: string; key: string; executionToken: string },
  now = Date.now(),
) {
  const version = prepared.expectedVersion + 1;
  const versionId = crypto.randomUUID();
  const actorKey = `advertiser:${prepared.advertiserRef}`;
  const imagePath = input.format === "static_display" ? `/api/ads/assets/${input.assetId}` : null;
  const body = {
    creativeId: prepared.creativeId,
    versionId,
    version,
    previousVersionId: prepared.expectedVersionId,
    previousVersion: prepared.expectedVersion,
    preflight,
  };
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_creative_versions
      (id,creative_id,version,headline,description,image_asset_path,alt_text,call_to_action,landing_url,
       display_url,advertiser_display_name,language,content_hash,review_status,created_at)
      SELECT ?,cr.id,?,?,?,?,?,?,?,?,?,?,?,'pending',?
      FROM hub_ad_creatives cr
      JOIN hub_ad_creative_versions current
        ON current.creative_id=cr.id AND current.version=cr.current_version
      JOIN hub_ad_advertisers a ON a.advertiser_ref=cr.advertiser_ref
      JOIN hub_ad_admin_idempotency i
        ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      WHERE cr.id=? AND cr.advertiser_ref=? AND cr.current_version=? AND current.id=?
        AND cr.format=? AND cr.status IN ('pending_review','rejected')
        AND current.review_status IN ('needs_changes','rejected')
        AND a.status='active' AND a.policy_version IS NOT NULL
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM hub_ad_image_assets ia
          WHERE ia.id=? AND ia.advertiser_ref=cr.advertiser_ref
            AND ia.status='clean' AND ia.structural_result='passed' AND ia.scanner_result='clean'
        ))`)
      .bind(versionId, version, input.headline, input.description, imagePath, input.altText,
        input.callToAction, input.landingUrl, input.displayUrl, input.advertiserDisplayName,
        input.language, hubAdCreativeContentHash(input, version), now,
        reservation.scope, reservation.key, reservation.executionToken, prepared.creativeId,
        prepared.advertiserRef, prepared.expectedVersion, prepared.expectedVersionId, prepared.format,
        input.assetId ?? null, input.assetId ?? null),
    database.prepare(`UPDATE hub_ad_creatives AS cr SET current_version=?,status='pending_review',updated_at=?
      WHERE cr.id=? AND cr.advertiser_ref=? AND cr.format=? AND cr.current_version=?
        AND cr.status IN ('pending_review','rejected')
        AND EXISTS (SELECT 1 FROM hub_ad_creative_versions cv WHERE cv.id=? AND cv.creative_id=cr.id AND cv.version=?)`)
      .bind(version, now, prepared.creativeId, prepared.advertiserRef, prepared.format,
        prepared.expectedVersion, versionId, version),
    database.prepare(`UPDATE hub_ad_line_item_creatives SET creative_version_id=?
      WHERE creative_version_id=?`).bind(versionId, prepared.expectedVersionId),
    database.prepare(`INSERT INTO hub_ad_audit_logs
      (id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at)
      SELECT ?,?,'creative.version_created','creative',cr.id,?,?,?
      FROM hub_ad_creatives cr WHERE cr.id=? AND cr.advertiser_ref=? AND cr.current_version=?
        AND EXISTS (SELECT 1 FROM hub_ad_creative_versions cv
          WHERE cv.id=? AND cv.creative_id=cr.id AND cv.version=?)`)
      .bind(crypto.randomUUID(), actorKey,
        JSON.stringify({ versionId: prepared.expectedVersionId, version: prepared.expectedVersion }),
        JSON.stringify({ versionId, version }), now, prepared.creativeId, prepared.advertiserRef,
        version, versionId, version),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ]);
  for (const index of [0, 1, 3, 4]) {
    if ((results[index]?.meta.changes ?? 0) !== 1) {
      throw new Error("hub_ad_creative_resubmission_atomic_commit_unconfirmed");
    }
  }
  return body;
}

export async function resolveHubAdImageAssetPath(database: D1Database, input: HubAdCreativeInput): Promise<string | null | undefined> {
  if (input.format !== "static_display") return null;
  if (!input.assetId) return undefined;
  const asset = await database.prepare(`SELECT id FROM hub_ad_image_assets WHERE id = ? AND advertiser_ref = ?
    AND status = 'clean' AND structural_result = 'passed' AND scanner_result = 'clean'`)
    .bind(input.assetId, input.advertiserRef).first<{ id: string }>();
  return asset ? `/api/ads/assets/${asset.id}` : undefined;
}

export async function attachHubAdCreative(database: D1Database, lineItemId: string, creativeId: string, now = Date.now()) {
  const row = await database.prepare(`SELECT cv.id AS version_id
    FROM hub_ad_line_items li JOIN hub_ad_campaigns c ON c.id = li.campaign_id
    JOIN hub_ad_line_item_placements lip ON lip.line_item_id = li.id JOIN hub_ad_placements p ON p.id = lip.placement_id
    JOIN hub_ad_creatives cr ON cr.id = ? JOIN hub_ad_creative_versions cv ON cv.creative_id = cr.id AND cv.version = cr.current_version
    WHERE li.id = ? AND c.advertiser_ref = cr.advertiser_ref AND p.format = cr.format LIMIT 1`)
    .bind(creativeId, lineItemId).first<{ version_id: string }>();
  if (!row) return false;
  await database.batch([
    database.prepare("INSERT OR IGNORE INTO hub_ad_line_item_creatives (line_item_id, creative_version_id) VALUES (?, ?)")
      .bind(lineItemId, row.version_id),
    audit(database, "creative.attached", "line_item", lineItemId, { creativeId, creativeVersionId: row.version_id }, now),
  ]);
  return true;
}
