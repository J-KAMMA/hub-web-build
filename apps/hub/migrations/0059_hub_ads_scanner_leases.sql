-- Short-lived, one-time leases prevent two scanner workers from publishing the same asset.
ALTER TABLE hub_ad_image_assets ADD COLUMN scan_attempts INTEGER NOT NULL DEFAULT 0 CHECK (scan_attempts BETWEEN 0 AND 10);
ALTER TABLE hub_ad_image_assets ADD COLUMN scan_lease_token_hash TEXT;
ALTER TABLE hub_ad_image_assets ADD COLUMN scan_lease_expires_at INTEGER;

CREATE INDEX IF NOT EXISTS hub_ad_image_assets_scan_queue
  ON hub_ad_image_assets(status, scan_lease_expires_at, scan_attempts, created_at);
