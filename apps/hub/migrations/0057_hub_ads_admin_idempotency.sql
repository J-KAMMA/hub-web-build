-- Durable idempotency reservations for Hub Ads administrative mutations.

CREATE TABLE IF NOT EXISTS hub_ad_admin_idempotency (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  execution_token TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'processing' CHECK (state IN ('processing', 'completed')),
  response_status INTEGER,
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_admin_idempotency_expiry
  ON hub_ad_admin_idempotency (expires_at);
