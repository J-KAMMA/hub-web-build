CREATE TABLE IF NOT EXISTS hub_ad_feedback (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  frequency_bucket_hash TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  creative_version_id TEXT NOT NULL,
  advertiser_ref TEXT NOT NULL,
  category_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('hide_ad','hide_advertiser','not_interested','repetitive')),
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(token_id, action)
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_feedback_bucket_time
  ON hub_ad_feedback(frequency_bucket_hash, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_ad_feedback_creative_time
  ON hub_ad_feedback(creative_version_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_ad_feedback_advertiser_time
  ON hub_ad_feedback(advertiser_ref, occurred_at DESC);
