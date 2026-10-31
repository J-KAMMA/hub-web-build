import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

export type PreparedHubAdCampaignResubmission = {
  campaignId: string;
  advertiserRef: string;
  expectedStatus: "needs_changes";
  expectedReviewStatus: "needs_changes";
  expectedResubmissionVersion: number;
};

export async function prepareHubAdCampaignResubmission(
  database: D1Database,
  campaignId: string,
  advertiserRef: string,
): Promise<PreparedHubAdCampaignResubmission | null> {
  return database.prepare(`SELECT id campaignId,advertiser_ref advertiserRef,status expectedStatus,
      review_status expectedReviewStatus,resubmission_version expectedResubmissionVersion
    FROM hub_ad_campaigns
    WHERE id=? AND advertiser_ref=? AND status='needs_changes' AND review_status='needs_changes'`)
    .bind(campaignId, advertiserRef).first<PreparedHubAdCampaignResubmission>();
}

export async function resubmitHubAdCampaignAtomically(
  database: D1Database,
  prepared: PreparedHubAdCampaignResubmission,
  reservation: { scope: string; key: string; executionToken: string },
  now = Date.now(),
) {
  const resubmissionVersion = prepared.expectedResubmissionVersion + 1;
  const auditId = reservation.executionToken;
  const body = { ok: true, campaignId: prepared.campaignId, resubmissionVersion, auditId, submittedAt: now };
  const results = await database.batch([
    database.prepare(`UPDATE hub_ad_campaigns AS c
      SET status='submitted',review_status='pending',review_reason=NULL,review_audit_id=NULL,reviewed_at=NULL,
        resubmission_version=?,resubmission_audit_id=?,resubmitted_at=?,updated_at=?
      WHERE c.id=? AND c.advertiser_ref=? AND c.status=? AND c.review_status=? AND c.resubmission_version=?
        AND EXISTS (SELECT 1 FROM hub_ad_advertisers a
          WHERE a.advertiser_ref=c.advertiser_ref AND a.status='active' AND a.policy_version IS NOT NULL)
        AND EXISTS (SELECT 1 FROM hub_ad_admin_idempotency i
          WHERE i.scope=? AND i.idempotency_key=? AND i.execution_token=? AND i.state='processing')`)
      .bind(resubmissionVersion, auditId, now, now, prepared.campaignId, prepared.advertiserRef,
        prepared.expectedStatus, prepared.expectedReviewStatus, prepared.expectedResubmissionVersion,
        reservation.scope, reservation.key, reservation.executionToken),
    database.prepare(`UPDATE hub_ad_admin_idempotency
      SET state='completed',response_status=200,response_json=?,updated_at=?
      WHERE scope=? AND idempotency_key=? AND execution_token=? AND state='processing'`)
      .bind(JSON.stringify(body), now, reservation.scope, reservation.key, reservation.executionToken),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new Error("hub_ad_campaign_resubmission_atomic_commit_unconfirmed");
  }
  return body;
}
