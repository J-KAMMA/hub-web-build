import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { HUB_AD_FORMATS, HUB_AD_TARGETING_KEYS, type HubAdFormat } from "@/lib/hub-ads";

export interface HubAdPlacementInput {
  placementKey: string; displayName: string; surfaceType: string; format: HubAdFormat; allowedDimensions: string[];
  pageCategory: string; pricingModel: "fixed_period" | "viewable_cpm"; floorPriceJpyMicros: number;
  maximumAdsPerPage: number; targetingAllowed: string[];
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

export function parseHubAdPlacementInput(value: unknown): HubAdPlacementInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const placementKey = text(body.placementKey, 120); const displayName = text(body.displayName, 120);
  const surfaceType = text(body.surfaceType, 80); const pageCategory = text(body.pageCategory, 80);
  if (!placementKey || !/^[a-z0-9]+(?:[._-][a-z0-9]+){1,7}$/.test(placementKey) || !displayName || !surfaceType || !pageCategory) return null;
  if (!HUB_AD_FORMATS.includes(body.format as HubAdFormat)) return null;
  if (body.pricingModel !== "fixed_period" && body.pricingModel !== "viewable_cpm") return null;
  if (!Number.isSafeInteger(body.floorPriceJpyMicros) || Number(body.floorPriceJpyMicros) < 0) return null;
  if (!Number.isInteger(body.maximumAdsPerPage) || Number(body.maximumAdsPerPage) < 0 || Number(body.maximumAdsPerPage) > 3) return null;
  if (!Array.isArray(body.allowedDimensions) || !body.allowedDimensions.every((item) => typeof item === "string" && /^\d{2,4}x\d{2,4}$/.test(item))) return null;
  if (!Array.isArray(body.targetingAllowed) || !body.targetingAllowed.every((item) => typeof item === "string" && HUB_AD_TARGETING_KEYS.includes(item as typeof HUB_AD_TARGETING_KEYS[number]))) return null;
  return { placementKey, displayName, surfaceType, pageCategory, format: body.format as HubAdFormat,
    pricingModel: body.pricingModel, floorPriceJpyMicros: Number(body.floorPriceJpyMicros), maximumAdsPerPage: Number(body.maximumAdsPerPage),
    allowedDimensions: [...new Set(body.allowedDimensions as string[])].sort(),
    targetingAllowed: [...new Set(body.targetingAllowed as string[])].sort() };
}

export async function listHubAdPlacements(database: D1Database) {
  const result = await database.prepare(`SELECT id, placement_key AS placementKey, display_name AS displayName,
    surface_type AS surfaceType, format, allowed_dimensions_json AS allowedDimensionsJson, page_category AS pageCategory,
    pricing_model AS pricingModel, floor_price_jpy_micros AS floorPriceJpyMicros, maximum_ads_per_page AS maximumAdsPerPage,
    targeting_allowed_json AS targetingAllowedJson, status, created_at AS createdAt, updated_at AS updatedAt
    FROM hub_ad_placements ORDER BY placement_key`).all();
  return result.results;
}

export async function createHubAdPlacement(database: D1Database, input: HubAdPlacementInput, now = Date.now()) {
  const existing = await database.prepare("SELECT id FROM hub_ad_placements WHERE placement_key = ?").bind(input.placementKey).first<{ id: string }>();
  if (existing) return { id: existing.id, created: false };
  const id = crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO hub_ad_placements
      (id, placement_key, display_name, surface_type, format, allowed_dimensions_json, owner_type, page_category,
       pricing_model, floor_price_jpy_micros, maximum_ads_per_page, refresh_allowed, targeting_allowed_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'hub', ?, ?, ?, ?, 0, ?, 'draft', ?, ?)`)
      .bind(id, input.placementKey, input.displayName, input.surfaceType, input.format, JSON.stringify(input.allowedDimensions),
        input.pageCategory, input.pricingModel, input.floorPriceJpyMicros, input.maximumAdsPerPage, JSON.stringify(input.targetingAllowed), now, now),
    database.prepare(`INSERT INTO hub_ad_audit_logs
      (id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at)
      VALUES (?, 'moderation-admin', 'placement.created', 'placement', ?, NULL, ?, ?)`)
      .bind(crypto.randomUUID(), id, JSON.stringify(input), now),
  ]);
  return { id, created: true };
}
