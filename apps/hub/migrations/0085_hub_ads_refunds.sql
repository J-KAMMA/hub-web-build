CREATE TABLE IF NOT EXISTS hub_ad_refunds (
  id TEXT PRIMARY KEY,
  deposit_id TEXT NOT NULL REFERENCES hub_ad_x402_deposits(id) ON DELETE RESTRICT,
  campaign_id TEXT NOT NULL REFERENCES hub_ad_campaigns(id) ON DELETE RESTRICT,
  amount_usdc_atomic INTEGER NOT NULL CHECK(amount_usdc_atomic > 0),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
  settlement_network TEXT NOT NULL,
  settlement_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','recorded')),
  created_at INTEGER NOT NULL,
  recorded_at INTEGER,
  UNIQUE(deposit_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_ad_refunds_campaign ON hub_ad_refunds(campaign_id,created_at);
