PRAGMA foreign_keys = ON;

-- Durable per-profile and global limits protect the shared YouTube API quota.
-- No IP address, wallet identifier, or raw search term is persisted.
CREATE TABLE IF NOT EXISTS video_search_rate_limits (
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, scope_id, window_started_at),
  CHECK (scope IN ('profile', 'global')),
  CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_video_search_rate_limits_expiry
  ON video_search_rate_limits(expires_at);

-- Six-hour result cache is keyed only by a SHA-256 digest of the normalized query.
CREATE TABLE IF NOT EXISTS video_search_cache (
  query_hash TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (length(query_hash) = 64),
  CHECK (length(result_json) <= 16384)
);

CREATE INDEX IF NOT EXISTS idx_video_search_cache_expiry
  ON video_search_cache(expires_at);
