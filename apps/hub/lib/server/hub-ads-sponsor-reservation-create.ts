import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

export type HubAdSponsorReservationInput = {
  placementKey: string;
  startAt: number;
  endAt: number;
  reservedBudgetJpyMicros: number;
};

export type HubAdSponsorReservationConflict =
  | "not_found_or_not_sponsorship"
  | "campaign_not_reservable"
  | "reservation_outside_campaign"
  | "placement_unavailable"
  | "budget_below_floor"
  | "campaign_budget_exceeded"
  | "placement_already_reserved";

export type PreparedHubAdSponsorReservation = {
  campaignId: string;
  advertiserRef: string;
  placementId: string;
  input: HubAdSponsorReservationInput;
};

type PreparationRow = {
  campaignId: string;
  objective: string;
  campaignStatus: string;
  reviewStatus: string;
  totalBudgetJpyMicros: number;
  campaignStartAt: number;
  campaignEndAt: number;
  placementId: string | null;
  placementStatus: string | null;
  floorPriceJpyMicros: number | null;
  reservedBudgetJpyMicros: number;
  hasApprovedOverlap: number;
};

const RESERVABLE_CAMPAIGN_STATUSES = new Set([
  "draft", "submitted", "under_review", "needs_changes", "approved", "scheduled", "active", "paused",
]);

export function parseHubAdSponsorReservationInput(value: unknown): HubAdSponsorReservationInput | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const placementKey = String(body.placementKey ?? "");
  const startAt = Number(body.startAt);
  const endAt = Number(body.endAt);
  const reservedBudgetJpyMicros = Number(body.reservedBudgetJpyMicros);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+){1,7}$/.test(placementKey)
    || !Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || endAt <= startAt
    || !Number.isSafeInteger(reservedBudgetJpyMicros) || reservedBudgetJpyMicros < 1) return null;
  return { placementKey, startAt, endAt, reservedBudgetJpyMicros };
}

export async function prepareHubAdSponsorReservation(
  database: D1Database,
  campaignId: string,
  advertiserRef: string,
  input: HubAdSponsorReservationInput,
  now = Date.now(),
): Promise<{ kind: "prepared"; value: PreparedHubAdSponsorReservation } | { kind: "conflict"; reason: HubAdSponsorReservationConflict }> {
  const row = await database.prepare(`SELECT c.id campaignId,c.objective,c.status campaignStatus,
      c.review_status reviewStatus,c.total_budget_jpy_micros totalBudgetJpyMicros,
      c.start_at campaignStartAt,c.end_at campaignEndAt,p.id placementId,p.status placementStatus,
      p.floor_price_jpy_micros floorPriceJpyMicros,
      COALESCE((SELECT SUM(r.reserved_budget_jpy_micros) FROM hub_ad_sponsor_reservations r
        WHERE r.campaign_id=c.id AND r.status<>'cancelled'),0) reservedBudgetJpyMicros,
      EXISTS(SELECT 1 FROM hub_ad_sponsor_reservations r
        WHERE r.placement_id=p.id AND r.status IN ('approved','active')
          AND r.start_at<? AND r.end_at>?) hasApprovedOverlap
    FROM hub_ad_campaigns c
    LEFT JOIN hub_ad_placements p ON p.placement_key=?
    WHERE c.id=? AND c.advertiser_ref=?`)
    .bind(input.endAt, input.startAt, input.placementKey, campaignId, advertiserRef).first<PreparationRow>();
  if (!row || row.objective !== "sponsorship") return { kind: "conflict", reason: "not_found_or_not_sponsorship" };
  if (!RESERVABLE_CAMPAIGN_STATUSES.has(row.campaignStatus) || row.reviewStatus === "rejected") {
    return { kind: "conflict", reason: "campaign_not_reservable" };
  }
  if (input.startAt <= now || input.startAt < row.campaignStartAt || input.endAt > row.campaignEndAt) {
    return { kind: "conflict", reason: "reservation_outside_campaign" };
  }
  if (!row.placementId || row.placementStatus !== "active") return { kind: "conflict", reason: "placement_unavailable" };
  if (input.reservedBudgetJpyMicros < (row.floorPriceJpyMicros ?? 0)) {
    return { kind: "conflict", reason: "budget_below_floor" };
  }
  if (row.reservedBudgetJpyMicros + input.reservedBudgetJpyMicros > row.totalBudgetJpyMicros) {
    return { kind: "conflict", reason: "campaign_budget_exceeded" };
  }
  if (row.hasApprovedOverlap) return { kind: "conflict", reason: "placement_already_reserved" };
  return { kind: "prepared", value: { campaignId, advertiserRef, placementId: row.placementId, input } };
}

export async function createHubAdSponsorReservationAtomically(
  database: D1Database,
  prepared: PreparedHubAdSponsorReservation,
  reservation: { scope: string; key: string; executionToken: string },
  id = crypto.randomUUID(),
  now = Date.now(),
) {
  const auditId = reservation.executionToken;
  const { input } = prepared;
  const body = {
    id,
    status: "draft" as const,
    delivery: "priority_not_guaranteed" as const,
    campaignId: prepared.campaignId,
    placementId: prepared.placementId,
    startAt: input.startAt,
    endAt: input.endAt,
    reservedBudgetJpyMicros: input.reservedBudgetJpyMicros,
    auditId,
    createdAt: now,
  };
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_sponsor_reservations(
        id,campaign_id,placement_id,start_at,end_at,minimum_viewable_impressions,
        reserved_budget_jpy_micros,status,created_at,updated_at
      )
      SELECT ?,c.id,p.id,?,?,1,?,'draft',?,?
      FROM hub_ad_campaigns c
      JOIN hub_ad_placements p ON p.id=? AND p.placement_key=?
      JOIN hub_ad_advertisers a ON a.advertiser_ref=c.advertiser_ref
      WHERE c.id=? AND c.advertiser_ref=? AND c.objective='sponsorship'
        AND c.status IN ('draft','submitted','under_review','needs_changes','approved','scheduled','active','paused')
        AND c.review_status<>'rejected'
        AND ?>? AND ?>=c.start_at AND ?<=c.end_at
        AND p.status='active' AND ?>=p.floor_price_jpy_micros
        AND a.status='active' AND a.policy_version IS NOT NULL
        AND COALESCE((SELECT SUM(r.reserved_budget_jpy_micros) FROM hub_ad_sponsor_reservations r
          WHERE r.campaign_id=c.id AND r.status<>'cancelled'),0)+?<=c.total_budget_jpy_micros
        AND NOT EXISTS(SELECT 1 FROM hub_ad_sponsor_reservations r
          WHERE r.placement_id=p.id AND r.status IN ('approved','active')
            AND r.start_at<? AND r.end_at>?)
        AND EXISTS(SELECT 1 FROM hub_ad_admin_idempotency i
          WHERE i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing')`)
      .bind(id, input.startAt, input.endAt, input.reservedBudgetJpyMicros, now, now,
        prepared.placementId, input.placementKey, prepared.campaignId, prepared.advertiserRef,
        input.startAt, now, input.startAt, input.endAt, input.reservedBudgetJpyMicros,
        input.reservedBudgetJpyMicros, input.endAt, input.startAt,
        reservation.scope, reservation.key, reservation.executionToken),
    database.prepare(`INSERT INTO hub_ad_audit_logs(
        id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at
      )
      SELECT ?,'advertiser:' || c.advertiser_ref,'sponsor_reservation.created','sponsor_reservation',r.id,NULL,
        json_object('campaignId',r.campaign_id,'placementId',r.placement_id,'startAt',r.start_at,
          'endAt',r.end_at,'reservedBudgetJpyMicros',r.reserved_budget_jpy_micros,
          'status',r.status,'delivery','priority_not_guaranteed'),?
      FROM hub_ad_sponsor_reservations r JOIN hub_ad_campaigns c ON c.id=r.campaign_id
      WHERE r.id=? AND c.advertiser_ref=?`)
      .bind(auditId, now, id, prepared.advertiserRef),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=201,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_sponsor_reservation_creation_atomic_commit_unconfirmed");
  }
  return body;
}
