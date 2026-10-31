CREATE TABLE IF NOT EXISTS hub_ad_assertion_replay (
  jti TEXT PRIMARY KEY,
  consumed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_ad_assertion_replay_expiry ON hub_ad_assertion_replay(expires_at);
