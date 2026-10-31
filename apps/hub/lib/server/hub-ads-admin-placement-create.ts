import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { HubAdPlacementInput } from "@/lib/server/hub-ads-admin";

type PlacementSnapshot = {
  id: string;
  displayName: string;
  surfaceType: string;
  format: string;
  allowedDimensionsJson: string;
  pageCategory: string;
  pricingModel: string;
  floorPriceJpyMicros: number;
  maximumAdsPerPage: number;
  targetingAllowedJson: string;
};

// Both sides are normalized. Normalizing only the stored side made the same set in another
// order, or with a duplicate, report a key conflict instead of converging on the existing row.
const canonicalStringArray = (items: readonly string[]) => JSON.stringify([...new Set(items)].sort());

function sameStringArray(serialized: string, expected: string[]) {
  try {
    const value = JSON.parse(serialized) as unknown;
    return Array.isArray(value)
      && value.every((item) => typeof item === "string")
      && canonicalStringArray(value as string[]) === canonicalStringArray(expected);
  } catch {
    return false;
  }
}

function matches(row: PlacementSnapshot, input: HubAdPlacementInput) {
  return row.displayName === input.displayName
    && row.surfaceType === input.surfaceType
    && row.format === input.format
    && sameStringArray(row.allowedDimensionsJson, input.allowedDimensions)
    && row.pageCategory === input.pageCategory
    && row.pricingModel === input.pricingModel
    && row.floorPriceJpyMicros === input.floorPriceJpyMicros
    && row.maximumAdsPerPage === input.maximumAdsPerPage
    && sameStringArray(row.targetingAllowedJson, input.targetingAllowed);
}

export async function prepareHubAdAdminPlacementCreation(
  database: D1Database,
  input: HubAdPlacementInput,
): Promise<
  | { kind: "prepared" }
  | { kind: "existing"; id: string }
  | { kind: "conflict"; reason: "placement_key_exists" }
> {
  const row = await database.prepare(`SELECT id,display_name displayName,surface_type surfaceType,format,
      allowed_dimensions_json allowedDimensionsJson,page_category pageCategory,pricing_model pricingModel,
      floor_price_jpy_micros floorPriceJpyMicros,maximum_ads_per_page maximumAdsPerPage,
      targeting_allowed_json targetingAllowedJson
    FROM hub_ad_placements WHERE placement_key=?`)
    .bind(input.placementKey).first<PlacementSnapshot>();
  if (!row) return { kind: "prepared" };
  return matches(row, input)
    ? { kind: "existing", id: row.id }
    : { kind: "conflict", reason: "placement_key_exists" };
}

export async function createHubAdAdminPlacementAtomically(
  database: D1Database,
  input: HubAdPlacementInput,
  reservation: { scope: string; key: string; executionToken: string },
  id = crypto.randomUUID(),
  now = Date.now(),
) {
  const auditId = reservation.executionToken;
  const body = { id, created: true as const, placementKey: input.placementKey, auditId, createdAt: now };
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_placements(
        id,placement_key,display_name,surface_type,format,allowed_dimensions_json,owner_type,page_category,
        pricing_model,floor_price_jpy_micros,maximum_ads_per_page,refresh_allowed,targeting_allowed_json,
        status,created_at,updated_at
      )
      SELECT ?,?,?,?,?,?,'hub',?,?,?,?,0,?,'draft',?,?
      FROM hub_ad_admin_idempotency i
      WHERE i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
        AND NOT EXISTS(SELECT 1 FROM hub_ad_placements p WHERE p.placement_key=?)`)
      .bind(id, input.placementKey, input.displayName, input.surfaceType, input.format,
        JSON.stringify(input.allowedDimensions), input.pageCategory, input.pricingModel,
        input.floorPriceJpyMicros, input.maximumAdsPerPage, JSON.stringify(input.targetingAllowed), now, now,
        reservation.scope, reservation.key, reservation.executionToken, input.placementKey),
    database.prepare(`INSERT INTO hub_ad_audit_logs(
        id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at
      )
      SELECT ?,'moderation-admin','placement.created','placement',p.id,NULL,?,?
      FROM hub_ad_placements p JOIN hub_ad_admin_idempotency i
        ON i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing'
      WHERE p.id=? AND p.placement_key=?`)
      .bind(auditId, JSON.stringify(input), now,
        reservation.scope, reservation.key, reservation.executionToken, id, input.placementKey),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_admin_placement_atomic_create_unconfirmed");
  }
  return body;
}
