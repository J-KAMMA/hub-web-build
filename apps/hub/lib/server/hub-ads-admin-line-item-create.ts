import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { HubAdLineItemInput } from "@/lib/server/hub-ads-campaign-admin";

const CREATABLE_CAMPAIGN_STATUSES = new Set(["draft", "needs_changes", "approved"]);

export type HubAdAdminLineItemConflict =
  | "campaign_unavailable"
  | "campaign_pricing_mismatch"
  | "schedule_outside_campaign"
  | "campaign_budget_exceeded"
  | "placements_unavailable"
  | "placement_pricing_mismatch"
  | "placement_format_mismatch"
  | "rate_below_floor"
  | "targeting_not_allowed";

type CampaignSnapshot = {
  pricingModel: string;
  totalBudgetJpyMicros: number;
  startAt: number;
  endAt: number;
  status: string;
  allocatedBudgetJpyMicros: number;
};

type PlacementSnapshot = {
  id: string;
  format: string;
  pricingModel: string;
  floorPriceJpyMicros: number;
  targetingAllowedJson: string;
};

export async function prepareHubAdAdminLineItemCreation(
  database: D1Database,
  campaignId: string,
  input: HubAdLineItemInput,
): Promise<{ kind: "prepared" } | { kind: "conflict"; reason: HubAdAdminLineItemConflict }> {
  const campaign = await database.prepare(`SELECT c.pricing_model pricingModel,
      c.total_budget_jpy_micros totalBudgetJpyMicros,c.start_at startAt,c.end_at endAt,c.status,
      COALESCE((SELECT SUM(li.budget_jpy_micros) FROM hub_ad_line_items li
        WHERE li.campaign_id=c.id AND li.status<>'archived'),0) allocatedBudgetJpyMicros
    FROM hub_ad_campaigns c WHERE c.id=?`)
    .bind(campaignId).first<CampaignSnapshot>();
  if (!campaign || !CREATABLE_CAMPAIGN_STATUSES.has(campaign.status)) {
    return { kind: "conflict", reason: "campaign_unavailable" };
  }
  if (campaign.pricingModel !== input.pricingModel) {
    return { kind: "conflict", reason: "campaign_pricing_mismatch" };
  }
  if (input.startAt < campaign.startAt || input.endAt > campaign.endAt) {
    return { kind: "conflict", reason: "schedule_outside_campaign" };
  }
  if (campaign.allocatedBudgetJpyMicros + input.budgetJpyMicros > campaign.totalBudgetJpyMicros) {
    return { kind: "conflict", reason: "campaign_budget_exceeded" };
  }
  const placements = await database.prepare(`SELECT id,format,pricing_model pricingModel,
      floor_price_jpy_micros floorPriceJpyMicros,targeting_allowed_json targetingAllowedJson
    FROM hub_ad_placements
    WHERE id IN (${input.placementIds.map(() => "?").join(",")}) AND status<>'archived'`)
    .bind(...input.placementIds).all<PlacementSnapshot>();
  if (placements.results.length !== input.placementIds.length) {
    return { kind: "conflict", reason: "placements_unavailable" };
  }
  if (placements.results.some((placement) => placement.pricingModel !== input.pricingModel)) {
    return { kind: "conflict", reason: "placement_pricing_mismatch" };
  }
  if (new Set(placements.results.map((placement) => placement.format)).size !== 1) {
    return { kind: "conflict", reason: "placement_format_mismatch" };
  }
  if (placements.results.some((placement) => input.rateJpyMicros < placement.floorPriceJpyMicros)) {
    return { kind: "conflict", reason: "rate_below_floor" };
  }
  const targetingKeys = Object.keys(input.targetingRules)
    .filter((key) => key !== "estimatedAudience" && key !== "estimatedMonthlyImpressions");
  for (const placement of placements.results) {
    try {
      const allowed = new Set(JSON.parse(placement.targetingAllowedJson) as string[]);
      if (targetingKeys.some((key) => !allowed.has(key))) {
        return { kind: "conflict", reason: "targeting_not_allowed" };
      }
    } catch {
      return { kind: "conflict", reason: "targeting_not_allowed" };
    }
  }
  return { kind: "prepared" };
}

export async function createHubAdAdminLineItemAtomically(
  database: D1Database,
  campaignId: string,
  input: HubAdLineItemInput,
  reservation: { scope: string; key: string; executionToken: string },
  id = crypto.randomUUID(),
  now = Date.now(),
) {
  const placementIds = [...input.placementIds].sort();
  const targetingKeys = Object.keys(input.targetingRules)
    .filter((key) => key !== "estimatedAudience" && key !== "estimatedMonthlyImpressions");
  const placementSlots = placementIds.map(() => "?").join(",");
  const auditId = reservation.executionToken;
  const body = { id, campaignId, placementIds, budgetJpyMicros: input.budgetJpyMicros, auditId, createdAt: now };
  const auditAfter = {
    campaignId, placementIds, pricingModel: input.pricingModel,
    budgetJpyMicros: input.budgetJpyMicros, status: "draft",
  };
  const lineItemSql = `INSERT INTO hub_ad_line_items(
      id,campaign_id,name,targeting_rules_json,pricing_model,rate_jpy_micros,budget_jpy_micros,
      daily_budget_jpy_micros,start_at,end_at,priority,pacing_mode,frequency_cap_count,
      frequency_cap_window_seconds,status,created_at,updated_at
    )
    SELECT ?,c.id,?,?,?,?,?,?,?,?,?,?,?,?, 'draft',?,?
    FROM hub_ad_campaigns c
    JOIN hub_ad_admin_idempotency i
      ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
    WHERE c.id=? AND c.status IN ('draft','needs_changes','approved')
      AND c.pricing_model=? AND ?>=c.start_at AND ?<=c.end_at
      AND COALESCE((SELECT SUM(li.budget_jpy_micros) FROM hub_ad_line_items li
        WHERE li.campaign_id=c.id AND li.status<>'archived'),0)+?<=c.total_budget_jpy_micros
      AND (SELECT COUNT(*) FROM hub_ad_placements p
        WHERE p.id IN (${placementSlots}) AND p.status<>'archived')=?
      AND (SELECT COUNT(DISTINCT p.format) FROM hub_ad_placements p
        WHERE p.id IN (${placementSlots}) AND p.status<>'archived')=1
      AND NOT EXISTS(SELECT 1 FROM hub_ad_placements p
        WHERE p.id IN (${placementSlots}) AND p.status<>'archived'
          AND (p.pricing_model<>? OR p.floor_price_jpy_micros>?))
      AND NOT EXISTS(SELECT 1 FROM hub_ad_placements p
        WHERE p.id IN (${placementSlots}) AND p.status<>'archived'
          AND EXISTS(SELECT 1 FROM json_each(?) requested
            WHERE NOT EXISTS(SELECT 1 FROM json_each(p.targeting_allowed_json) allowed
              WHERE allowed.value=requested.value)))`;
  const statements = [
    database.prepare(lineItemSql).bind(
      id, input.name, JSON.stringify(input.targetingRules), input.pricingModel,
      input.rateJpyMicros, input.budgetJpyMicros, input.dailyBudgetJpyMicros ?? null,
      input.startAt, input.endAt, input.priority, input.pacingMode,
      input.frequencyCapCount ?? null, input.frequencyCapWindowSeconds ?? null, now, now,
      reservation.scope, reservation.key, reservation.executionToken,
      campaignId, input.pricingModel, input.startAt, input.endAt, input.budgetJpyMicros,
      ...placementIds, placementIds.length,
      ...placementIds,
      ...placementIds, input.pricingModel, input.rateJpyMicros,
      ...placementIds, JSON.stringify(targetingKeys),
    ),
    ...placementIds.map((placementId) => database.prepare(`INSERT INTO hub_ad_line_item_placements(
        line_item_id,placement_id
      )
      SELECT li.id,p.id FROM hub_ad_line_items li JOIN hub_ad_placements p ON p.id=?
      WHERE li.id=? AND li.campaign_id=? AND p.status<>'archived'
        AND p.pricing_model=li.pricing_model AND p.floor_price_jpy_micros<=li.rate_jpy_micros
        AND NOT EXISTS(SELECT 1 FROM json_each(li.targeting_rules_json) requested
          WHERE requested.key NOT IN ('estimatedAudience','estimatedMonthlyImpressions')
            AND NOT EXISTS(SELECT 1 FROM json_each(p.targeting_allowed_json) allowed
              WHERE allowed.value=requested.key))`)
      .bind(placementId, id, campaignId)),
    database.prepare(`INSERT INTO hub_ad_audit_logs(
        id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at
      )
      SELECT ?,'moderation-admin','line_item.created','line_item',li.id,NULL,?,?
      FROM hub_ad_line_items li
      WHERE li.id=? AND li.campaign_id=?
        AND (SELECT COUNT(*) FROM hub_ad_line_item_placements lip WHERE lip.line_item_id=li.id)=?`)
      .bind(auditId, JSON.stringify(auditAfter), now, id, campaignId, placementIds.length),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ];
  const results = await database.batch(statements);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_admin_line_item_atomic_create_unconfirmed");
  }
  return body;
}
