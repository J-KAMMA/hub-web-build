-- Hub Ads phase 1: first-party, pre-reviewed advertising only.
-- Advertiser contact, legal, payment, and identity records intentionally do not belong in Hub D1.

CREATE TABLE IF NOT EXISTS hub_ad_placements (
  id TEXT PRIMARY KEY,
  placement_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  surface_type TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('native', 'static_display', 'sponsored_search', 'text', 'sponsorship')),
  allowed_dimensions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_dimensions_json) AND json_type(allowed_dimensions_json) = 'array'),
  owner_type TEXT NOT NULL DEFAULT 'hub' CHECK (owner_type IN ('hub', 'community', 'content')),
  owner_id TEXT,
  page_category TEXT NOT NULL,
  pricing_model TEXT NOT NULL CHECK (pricing_model IN ('fixed_period', 'viewable_cpm')),
  floor_price_jpy_micros INTEGER NOT NULL DEFAULT 0 CHECK (floor_price_jpy_micros >= 0),
  maximum_ads_per_page INTEGER NOT NULL DEFAULT 1 CHECK (maximum_ads_per_page BETWEEN 0 AND 3),
  refresh_allowed INTEGER NOT NULL DEFAULT 0 CHECK (refresh_allowed = 0),
  targeting_allowed_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(targeting_allowed_json) AND json_type(targeting_allowed_json) = 'array'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_campaigns (
  id TEXT PRIMARY KEY,
  advertiser_ref TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  objective TEXT NOT NULL,
  pricing_model TEXT NOT NULL CHECK (pricing_model IN ('fixed_period', 'viewable_cpm')),
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  total_budget_jpy_micros INTEGER NOT NULL CHECK (total_budget_jpy_micros >= 0),
  daily_budget_jpy_micros INTEGER CHECK (daily_budget_jpy_micros IS NULL OR daily_budget_jpy_micros >= 0),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL CHECK (end_at > start_at),
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'needs_changes', 'approved', 'scheduled', 'active', 'paused', 'budget_exhausted', 'ended', 'rejected', 'cancelled', 'archived')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'approved_with_restrictions', 'needs_changes', 'rejected', 'escalated')),
  created_by_actor_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_line_items (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  targeting_rules_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(targeting_rules_json) AND json_type(targeting_rules_json) = 'object'),
  pricing_model TEXT NOT NULL CHECK (pricing_model IN ('fixed_period', 'viewable_cpm')),
  rate_jpy_micros INTEGER NOT NULL CHECK (rate_jpy_micros >= 0),
  budget_jpy_micros INTEGER NOT NULL CHECK (budget_jpy_micros >= 0),
  daily_budget_jpy_micros INTEGER CHECK (daily_budget_jpy_micros IS NULL OR daily_budget_jpy_micros >= 0),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL CHECK (end_at > start_at),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  pacing_mode TEXT NOT NULL DEFAULT 'even' CHECK (pacing_mode IN ('even', 'asap')),
  frequency_cap_count INTEGER CHECK (frequency_cap_count IS NULL OR frequency_cap_count BETWEEN 1 AND 100),
  frequency_cap_window_seconds INTEGER CHECK (frequency_cap_window_seconds IS NULL OR frequency_cap_window_seconds BETWEEN 60 AND 2592000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'budget_exhausted', 'ended', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_line_item_placements (
  line_item_id TEXT NOT NULL REFERENCES hub_ad_line_items(id) ON DELETE CASCADE,
  placement_id TEXT NOT NULL REFERENCES hub_ad_placements(id) ON DELETE CASCADE,
  PRIMARY KEY (line_item_id, placement_id)
);

CREATE TABLE IF NOT EXISTS hub_ad_creatives (
  id TEXT PRIMARY KEY,
  advertiser_ref TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('native', 'static_display', 'sponsored_search', 'text', 'sponsorship')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'paused', 'rejected', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_creative_versions (
  id TEXT PRIMARY KEY,
  creative_id TEXT NOT NULL REFERENCES hub_ad_creatives(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  headline TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_asset_path TEXT,
  alt_text TEXT NOT NULL DEFAULT '',
  call_to_action TEXT NOT NULL,
  landing_url TEXT NOT NULL,
  display_url TEXT NOT NULL,
  advertiser_display_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ja',
  content_hash TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'approved_with_restrictions', 'needs_changes', 'rejected', 'escalated')),
  reviewed_by_actor_key TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (creative_id, version),
  UNIQUE (content_hash)
);

CREATE TABLE IF NOT EXISTS hub_ad_line_item_creatives (
  line_item_id TEXT NOT NULL REFERENCES hub_ad_line_items(id) ON DELETE CASCADE,
  creative_version_id TEXT NOT NULL REFERENCES hub_ad_creative_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY (line_item_id, creative_version_id)
);

CREATE TABLE IF NOT EXISTS hub_ad_budget_ledger (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE RESTRICT,
  line_item_id TEXT REFERENCES hub_ad_line_items(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('authorization', 'viewable_charge', 'adjustment', 'refund')),
  amount_jpy_micros INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_measurement_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  placement_id TEXT NOT NULL REFERENCES hub_ad_placements(id) ON DELETE RESTRICT,
  line_item_id TEXT NOT NULL REFERENCES hub_ad_line_items(id) ON DELETE RESTRICT,
  creative_version_id TEXT NOT NULL REFERENCES hub_ad_creative_versions(id) ON DELETE RESTRICT,
  -- Seven-day, service-local HMAC bucket for frequency caps; never stores the raw browser token.
  frequency_bucket_hash TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('selected', 'served', 'rendered', 'viewable', 'clicked', 'invalid', 'filtered')),
  occurred_at INTEGER NOT NULL,
  billable INTEGER NOT NULL DEFAULT 0 CHECK (billable IN (0, 1)),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_system_controls (
  control_key TEXT PRIMARY KEY CHECK (control_key = 'global'),
  ads_paused INTEGER NOT NULL DEFAULT 1 CHECK (ads_paused IN (0, 1)),
  reason TEXT NOT NULL DEFAULT 'Initial fail-closed state',
  changed_by_actor_key TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_audit_logs (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  occurred_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO hub_ad_system_controls (control_key, ads_paused, reason, changed_by_actor_key, changed_at)
VALUES ('global', 1, 'Initial fail-closed state', 'migration', unixepoch() * 1000);

CREATE INDEX IF NOT EXISTS idx_hub_ad_placements_serve ON hub_ad_placements (placement_key, status);
CREATE INDEX IF NOT EXISTS idx_hub_ad_campaigns_serve ON hub_ad_campaigns (status, review_status, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_hub_ad_line_items_serve ON hub_ad_line_items (status, start_at, end_at, priority);
CREATE INDEX IF NOT EXISTS idx_hub_ad_measurement_events_report ON hub_ad_measurement_events (line_item_id, event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_hub_ad_measurement_frequency ON hub_ad_measurement_events (frequency_bucket_hash, line_item_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_hub_ad_budget_ledger_campaign ON hub_ad_budget_ledger (campaign_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_hub_ad_audit_logs_target ON hub_ad_audit_logs (target_type, target_id, occurred_at);
