-- Hub Ads image assets are isolated from general Hub media.
-- Object keys are internal implementation details and must never be returned by APIs.

CREATE TABLE IF NOT EXISTS hub_ad_image_assets (
  id TEXT PRIMARY KEY,
  advertiser_ref TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type = 'image/png'),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  width INTEGER,
  height INTEGER,
  original_sha256 TEXT NOT NULL,
  sanitized_sha256 TEXT,
  quarantine_object_key TEXT NOT NULL UNIQUE,
  clean_object_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'quarantined'
    CHECK (status IN ('quarantined', 'scan_pending', 'clean', 'rejected')),
  structural_result TEXT NOT NULL DEFAULT 'pending'
    CHECK (structural_result IN ('pending', 'passed', 'failed')),
  scanner_provider TEXT,
  scanner_result TEXT CHECK (scanner_result IS NULL OR scanner_result IN ('clean', 'malicious', 'error')),
  rejection_code TEXT,
  scanned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS hub_ad_image_assets_advertiser_status
  ON hub_ad_image_assets(advertiser_ref, status, created_at DESC);
