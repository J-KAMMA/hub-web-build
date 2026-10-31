-- Short-lived per-version leases prevent concurrent maintenance workers from
-- issuing duplicate outbound checks or storing duplicate observations.

CREATE TABLE IF NOT EXISTS hub_ad_landing_check_leases (
  creative_version_id TEXT PRIMARY KEY
    REFERENCES hub_ad_creative_versions(id) ON DELETE CASCADE,
  lease_token_hash TEXT NOT NULL CHECK(length(lease_token_hash)=64),
  lease_expires_at INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_landing_check_leases_expiry
  ON hub_ad_landing_check_leases(lease_expires_at,creative_version_id);

