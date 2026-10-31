CREATE TABLE IF NOT EXISTS direct_message_rate_limits (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, action, window_started_at),
  CHECK (action IN ('start', 'send')),
  CHECK (request_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_direct_message_rate_limits_expiry
  ON direct_message_rate_limits(expires_at);
