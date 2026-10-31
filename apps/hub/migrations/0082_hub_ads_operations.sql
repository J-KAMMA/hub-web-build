-- Advertiser-safe operations, policy workflow, aggregate conversions and alerts.
-- Hub stores only opaque advertiser references; legal identity remains outside Hub.

CREATE TABLE IF NOT EXISTS hub_ad_advertisers (
  advertiser_ref TEXT PRIMARY KEY CHECK (advertiser_ref GLOB 'adv_[0-9a-f]*' AND length(advertiser_ref) = 20),
  access_subject_hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  policy_version TEXT,
  policy_accepted_at INTEGER,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_review_appeals (
  id TEXT PRIMARY KEY,
  advertiser_ref TEXT NOT NULL REFERENCES hub_ad_advertisers(advertiser_ref) ON DELETE RESTRICT,
  target_type TEXT NOT NULL CHECK (target_type IN ('advertiser', 'campaign', 'creative')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 20 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
  resolution_note TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE (advertiser_ref, target_type, target_id, status)
);

CREATE TABLE IF NOT EXISTS hub_ad_public_reports (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('misleading', 'prohibited_product', 'unsafe_landing', 'impersonation', 'copyright', 'other')),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  UNIQUE (token_id, reason_code)
);

CREATE TABLE IF NOT EXISTS hub_ad_conversion_events (
  id TEXT PRIMARY KEY,
  conversion_key_hash TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE RESTRICT,
  line_item_id TEXT NOT NULL REFERENCES hub_ad_line_items(id) ON DELETE RESTRICT,
  creative_version_id TEXT NOT NULL REFERENCES hub_ad_creative_versions(id) ON DELETE RESTRICT,
  conversion_type TEXT NOT NULL CHECK (conversion_type IN ('lead', 'signup', 'purchase', 'qualified_visit')),
  value_jpy_micros INTEGER CHECK (value_jpy_micros IS NULL OR value_jpy_micros >= 0),
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (conversion_key_hash, conversion_type)
);

CREATE TABLE IF NOT EXISTS hub_ad_operational_alerts (
  id TEXT PRIMARY KEY,
  alert_key TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  category TEXT NOT NULL CHECK (category IN ('delivery', 'budget', 'measurement', 'scanner', 'payment', 'reporting')),
  summary TEXT NOT NULL CHECK (length(summary) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_appeals_status ON hub_ad_review_appeals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_hub_ad_public_reports_status ON hub_ad_public_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_hub_ad_conversions_campaign ON hub_ad_conversion_events(campaign_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_hub_ad_alerts_status ON hub_ad_operational_alerts(status, severity, updated_at);
