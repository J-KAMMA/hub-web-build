-- Advertiser submission diagnostics. Contains campaign-local aggregate checks only.
CREATE TABLE IF NOT EXISTS hub_ad_submission_checks (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE CASCADE,
  creative_version_id TEXT NOT NULL REFERENCES hub_ad_creative_versions(id) ON DELETE CASCADE,
  checks_json TEXT NOT NULL CHECK (json_valid(checks_json) AND json_type(checks_json) = 'array'),
  result TEXT NOT NULL CHECK (result IN ('passed', 'failed')),
  checked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_submission_checks_campaign
  ON hub_ad_submission_checks (campaign_id, checked_at);
