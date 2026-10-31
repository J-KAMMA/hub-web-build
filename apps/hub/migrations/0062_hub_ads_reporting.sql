-- Privacy-preserving Hub Ads reporting, anomaly review, and retention.

CREATE TABLE IF NOT EXISTS hub_ad_daily_reports (
  report_day TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE CASCADE,
  line_item_id TEXT NOT NULL REFERENCES hub_ad_line_items(id) ON DELETE CASCADE,
  placement_id TEXT NOT NULL REFERENCES hub_ad_placements(id) ON DELETE CASCADE,
  creative_version_id TEXT NOT NULL REFERENCES hub_ad_creative_versions(id) ON DELETE CASCADE,
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  served_count INTEGER NOT NULL DEFAULT 0 CHECK (served_count >= 0),
  rendered_count INTEGER NOT NULL DEFAULT 0 CHECK (rendered_count >= 0),
  viewable_count INTEGER NOT NULL DEFAULT 0 CHECK (viewable_count >= 0),
  clicked_count INTEGER NOT NULL DEFAULT 0 CHECK (clicked_count >= 0),
  invalid_count INTEGER NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  filtered_count INTEGER NOT NULL DEFAULT 0 CHECK (filtered_count >= 0),
  spend_jpy_micros INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (report_day, line_item_id, placement_id, creative_version_id)
);

CREATE TABLE IF NOT EXISTS hub_ad_traffic_reviews (
  id TEXT PRIMARY KEY,
  report_day TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE CASCADE,
  line_item_id TEXT NOT NULL REFERENCES hub_ad_line_items(id) ON DELETE CASCADE,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('clicks_exceed_rendered', 'clicks_exceed_viewable', 'high_click_rate', 'event_sequence_mismatch')),
  severity TEXT NOT NULL CHECK (severity IN ('medium', 'high')),
  observed_count INTEGER NOT NULL CHECK (observed_count >= 0),
  baseline_count INTEGER NOT NULL CHECK (baseline_count >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by_actor_key TEXT,
  UNIQUE (report_day, line_item_id, reason_code)
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_daily_reports_campaign ON hub_ad_daily_reports (campaign_id, report_day);
CREATE INDEX IF NOT EXISTS idx_hub_ad_traffic_reviews_open ON hub_ad_traffic_reviews (status, report_day);
