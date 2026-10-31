PRAGMA foreign_keys = ON;

-- Social publishing has a separate bucket because the original thread table
-- intentionally permits only thread_create and thread_reply actions.
CREATE TABLE IF NOT EXISTS hub_social_post_rate_limit_buckets (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, window_started_at),
  CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_hub_social_post_rate_limit_expiry
  ON hub_social_post_rate_limit_buckets(expires_at);
