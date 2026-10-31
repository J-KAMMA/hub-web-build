CREATE TABLE IF NOT EXISTS hub_ad_x402_deposits (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE RESTRICT,
  advertiser_ref TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network = 'eip155:84532'),
  asset TEXT NOT NULL,
  amount_usdc_atomic INTEGER NOT NULL CHECK (amount_usdc_atomic > 0),
  credited_jpy_micros INTEGER NOT NULL CHECK (credited_jpy_micros > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'failed', 'refund_review')),
  transaction_hash TEXT UNIQUE,
  expires_at INTEGER NOT NULL,
  settled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_x402_deposits_campaign
  ON hub_ad_x402_deposits (campaign_id, status, created_at);

