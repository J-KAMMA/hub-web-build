-- Advanced privacy-preserving delivery controls. All reporting remains aggregate.

CREATE TABLE IF NOT EXISTS hub_ad_optimization_settings (
  campaign_id TEXT PRIMARY KEY REFERENCES hub_ad_campaigns(id) ON DELETE CASCADE,
  pacing_mode TEXT NOT NULL DEFAULT 'even' CHECK (pacing_mode IN ('even','asap','backloaded')),
  optimization_goal TEXT NOT NULL DEFAULT 'viewable' CHECK (optimization_goal IN ('viewable','click','conversion','quality')),
  ab_testing_enabled INTEGER NOT NULL DEFAULT 1 CHECK (ab_testing_enabled IN (0,1)),
  minimum_exploration_percent INTEGER NOT NULL DEFAULT 10 CHECK (minimum_exploration_percent BETWEEN 5 AND 50),
  auto_placement_optimization INTEGER NOT NULL DEFAULT 1 CHECK (auto_placement_optimization IN (0,1)),
  maximum_negative_feedback_rate REAL NOT NULL DEFAULT 0.02 CHECK (maximum_negative_feedback_rate BETWEEN 0.001 AND 0.2),
  maximum_page_ad_density REAL NOT NULL DEFAULT 0.125 CHECK (maximum_page_ad_density BETWEEN 0.05 AND 0.25),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_quality_audits (
  creative_version_id TEXT PRIMARY KEY REFERENCES hub_ad_creative_versions(id) ON DELETE CASCADE,
  clarity_score INTEGER NOT NULL CHECK (clarity_score BETWEEN 0 AND 100),
  landing_score INTEGER NOT NULL CHECK (landing_score BETWEEN 0 AND 100),
  performance_score INTEGER NOT NULL CHECK (performance_score BETWEEN 0 AND 100),
  policy_score INTEGER NOT NULL CHECK (policy_score BETWEEN 0 AND 100),
  composite_score INTEGER NOT NULL CHECK (composite_score BETWEEN 0 AND 100),
  audited_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_ad_sponsor_reservations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE CASCADE,
  placement_id TEXT NOT NULL REFERENCES hub_ad_placements(id) ON DELETE RESTRICT,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  minimum_viewable_impressions INTEGER NOT NULL CHECK (minimum_viewable_impressions > 0),
  reserved_budget_jpy_micros INTEGER NOT NULL CHECK (reserved_budget_jpy_micros > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','active','fulfilled','cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS hub_ad_experience_daily (
  report_day TEXT NOT NULL,
  placement_id TEXT NOT NULL REFERENCES hub_ad_placements(id) ON DELETE CASCADE,
  page_views INTEGER NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  ad_opportunities INTEGER NOT NULL DEFAULT 0 CHECK (ad_opportunities >= 0),
  ads_served INTEGER NOT NULL DEFAULT 0 CHECK (ads_served >= 0),
  hidden_count INTEGER NOT NULL DEFAULT 0 CHECK (hidden_count >= 0),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  slow_render_count INTEGER NOT NULL DEFAULT 0 CHECK (slow_render_count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (report_day, placement_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_sponsor_reservations_delivery ON hub_ad_sponsor_reservations(placement_id,status,start_at,end_at);
CREATE INDEX IF NOT EXISTS idx_hub_ad_experience_daily_placement ON hub_ad_experience_daily(placement_id,report_day);
