import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import {
  HUB_MINIMUM_AGE,
  HUB_PRIVACY_VERSION,
  HUB_TERMS_VERSION,
  type HubConsentRecord,
  type HubConsentSource,
} from "@/lib/hub-consent";

/* 登録と同じ batch に入れるための文。プロフィールの INSERT より後に置く。 */
export function signupConsentStatement(
  database: D1Database,
  profileId: string,
  source: HubConsentSource,
  now: string,
): D1PreparedStatement {
  return database.prepare(`INSERT INTO hub_consent_records (
    id, profile_id, terms_version, privacy_version, minimum_age_confirmed, source, consented_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), profileId, HUB_TERMS_VERSION, HUB_PRIVACY_VERSION, HUB_MINIMUM_AGE, source, now,
  );
}

type Row = {
  terms_version: string;
  privacy_version: string;
  minimum_age_confirmed: number;
  source: HubConsentSource;
  consented_at: string;
};

/* 自分の記録。既存利用者では空。失敗は呼び出し元へ投げる（書き出しは黙って空にしない）。 */
export async function listConsentRecords(database: D1Database, profileId: string): Promise<HubConsentRecord[]> {
  const result = await database.prepare(`SELECT terms_version, privacy_version, minimum_age_confirmed, source, consented_at
    FROM hub_consent_records WHERE profile_id=? ORDER BY consented_at, id`).bind(profileId).all<Row>();
  return (result.results ?? []).map((row) => ({
    termsVersion: row.terms_version,
    privacyVersion: row.privacy_version,
    minimumAgeConfirmed: row.minimum_age_confirmed,
    source: row.source,
    consentedAt: row.consented_at,
  }));
}
