CREATE TABLE IF NOT EXISTS hub_ad_landing_checks (
  id TEXT PRIMARY KEY,
  creative_version_id TEXT NOT NULL REFERENCES hub_ad_creative_versions(id) ON DELETE CASCADE,
  url_hash TEXT NOT NULL,
  final_host TEXT,
  result TEXT NOT NULL CHECK (result IN ('passed', 'failed', 'error')),
  reason_code TEXT NOT NULL,
  http_status INTEGER,
  redirect_count INTEGER NOT NULL DEFAULT 0 CHECK (redirect_count BETWEEN 0 AND 3),
  checked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS hub_ad_landing_checks_version_time
  ON hub_ad_landing_checks(creative_version_id, checked_at DESC);
