import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

export interface CreatorRevenueSummary {
  participationEnabled: boolean;
  finalizedAmountMicros: number;
  draftAmountMicros: number;
  eligibleUnits: number;
  finalizedPeriods: number;
}

type SummaryRow = {
  finalized_amount_micros: number | null;
  draft_amount_micros: number | null;
  eligible_units: number | null;
  finalized_periods: number | null;
};

export async function getD1CreatorRevenueSummary(database: D1Database, profileId: string): Promise<CreatorRevenueSummary> {
  const [preference, totals] = await Promise.all([
    database.prepare("SELECT participation_enabled FROM creator_monetization_preferences WHERE profile_id = ?")
      .bind(profileId).first<{ participation_enabled: number }>(),
    database.prepare(`SELECT
        COALESCE(SUM(CASE WHEN p.status = 'finalized' THEN a.amount_micros ELSE 0 END), 0) AS finalized_amount_micros,
        COALESCE(SUM(CASE WHEN p.status = 'draft' THEN a.amount_micros ELSE 0 END), 0) AS draft_amount_micros,
        COALESCE(SUM(CASE WHEN p.status = 'finalized' THEN a.eligible_units ELSE 0 END), 0) AS eligible_units,
        COUNT(DISTINCT CASE WHEN p.status = 'finalized' THEN p.id END) AS finalized_periods
      FROM creator_revenue_allocations a
      JOIN creator_revenue_periods p ON p.id = a.period_id
      WHERE a.profile_id = ? AND p.status <> 'void'`)
      .bind(profileId).first<SummaryRow>(),
  ]);
  return {
    participationEnabled: preference?.participation_enabled === 1,
    finalizedAmountMicros: Number(totals?.finalized_amount_micros ?? 0),
    draftAmountMicros: Number(totals?.draft_amount_micros ?? 0),
    eligibleUnits: Number(totals?.eligible_units ?? 0),
    finalizedPeriods: Number(totals?.finalized_periods ?? 0),
  };
}

export async function setD1CreatorMonetizationParticipation(
  database: D1Database,
  profileId: string,
  enabled: boolean,
  now = new Date(),
): Promise<void> {
  const timestamp = now.toISOString();
  await database.prepare(`INSERT INTO creator_monetization_preferences
      (profile_id, participation_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        participation_enabled = excluded.participation_enabled,
        updated_at = excluded.updated_at`)
    .bind(profileId, enabled ? 1 : 0, timestamp, timestamp).run();
}

