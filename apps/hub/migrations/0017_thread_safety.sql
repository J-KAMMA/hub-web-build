PRAGMA foreign_keys = ON;

ALTER TABLE threads ADD COLUMN slow_mode_seconds INTEGER NOT NULL DEFAULT 0
  CHECK (slow_mode_seconds IN (0,30,60,300,900,3600));

-- Per-profile reaction windows prevent burst voting without storing network or
-- cross-service identifiers.
CREATE TABLE IF NOT EXISTS hub_reaction_rate_limit_buckets (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, window_started_at),
  CHECK (request_count > 0)
);
CREATE INDEX IF NOT EXISTS idx_hub_reaction_rate_limit_expiry
  ON hub_reaction_rate_limit_buckets(expires_at);
