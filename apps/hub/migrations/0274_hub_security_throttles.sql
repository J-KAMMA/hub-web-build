-- Security throttles (JPCERT-AT-2026-0030 follow-up). No raw IP addresses are stored: client keys are
-- keyed HMAC digests (lib/ip-hash.ts) that rotate daily.

-- Generic fixed-window counters (e.g. per-profile translation provider calls). Rows are deleted
-- opportunistically once their window is over.
CREATE TABLE IF NOT EXISTS hub_security_rate_counters (
  scope TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, bucket_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_hub_security_rate_counters_window
  ON hub_security_rate_counters (window_start);

-- Failed admin-moderation sign-ins. Retention: rows older than 24 hours are deleted on write.
CREATE TABLE IF NOT EXISTS hub_admin_login_failures (
  key_hash TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_admin_login_failures_key
  ON hub_admin_login_failures (key_hash, failed_at);

-- Revoked admin session token IDs (logout). expires_at is the token's own expiry (30 minutes max);
-- expired rows are deleted on write.
CREATE TABLE IF NOT EXISTS hub_admin_session_denylist (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_admin_session_denylist_expiry
  ON hub_admin_session_denylist (expires_at);
