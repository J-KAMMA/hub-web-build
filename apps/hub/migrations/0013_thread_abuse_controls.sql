PRAGMA foreign_keys = ON;

-- Per-profile fixed windows avoid storing IP addresses or cross-service identifiers.
CREATE TABLE IF NOT EXISTS hub_rate_limit_buckets (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, action, window_started_at),
  CHECK (action IN ('thread_create','thread_reply')),
  CHECK (request_count > 0)
);
CREATE INDEX IF NOT EXISTS idx_hub_rate_limit_buckets_expiry
  ON hub_rate_limit_buckets(expires_at);
