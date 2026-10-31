-- Durable per-profile rate limit for POST /api/access-gates/check.
-- hub_rate_limit_buckets has a CHECK on action that SQLite cannot alter, so this uses its own table.
CREATE TABLE IF NOT EXISTS access_gate_check_rate (
  profile_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_access_gate_check_rate_window ON access_gate_check_rate (window_start);
