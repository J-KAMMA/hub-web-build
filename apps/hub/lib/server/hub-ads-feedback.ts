import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

export const HUB_AD_FEEDBACK_ACTIONS = ["hide_ad", "hide_advertiser", "not_interested", "repetitive"] as const;
export type HubAdFeedbackAction = (typeof HUB_AD_FEEDBACK_ACTIONS)[number];

export function parseHubAdFeedbackAction(value: unknown): HubAdFeedbackAction | null {
  return typeof value === "string" && HUB_AD_FEEDBACK_ACTIONS.includes(value as HubAdFeedbackAction)
    ? value as HubAdFeedbackAction
    : null;
}

export async function recordHubAdFeedback(database: D1Database, input: {
  tokenId: string;
  lineItemId: string;
  creativeVersionId: string;
  frequencyBucketHash: string;
  action: HubAdFeedbackAction;
  now: number;
}): Promise<boolean> {
  const result = await database.prepare(`INSERT OR IGNORE INTO hub_ad_feedback
    (id,token_id,frequency_bucket_hash,campaign_id,creative_version_id,advertiser_ref,category_key,action,occurred_at,created_at)
    SELECT ?,?,?,c.id,cv.id,c.advertiser_ref,c.objective,?,?,?
    FROM hub_ad_line_items li JOIN hub_ad_campaigns c ON c.id=li.campaign_id
    JOIN hub_ad_line_item_creatives lic ON lic.line_item_id=li.id
    JOIN hub_ad_creative_versions cv ON cv.id=lic.creative_version_id
    WHERE li.id=? AND cv.id=? LIMIT 1`)
    .bind(crypto.randomUUID(),input.tokenId,input.frequencyBucketHash,input.action,input.now,input.now,input.lineItemId,input.creativeVersionId).run();
  return (result.meta.changes ?? 0) > 0;
}
