CREATE TABLE IF NOT EXISTS hub_ad_conversion_keys (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_hub_ad_conversion_keys_campaign ON hub_ad_conversion_keys(campaign_id,status);
