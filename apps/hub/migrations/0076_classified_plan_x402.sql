CREATE TABLE IF NOT EXISTS classified_plan_payments (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE RESTRICT,
  payer_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  plan_code TEXT NOT NULL REFERENCES classified_plans(code) ON DELETE RESTRICT,
  network TEXT NOT NULL CHECK (network = 'eip155:84532'),
  asset TEXT NOT NULL,
  amount_usdc_atomic INTEGER NOT NULL CHECK (amount_usdc_atomic > 0),
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'failed', 'refund_review')),
  transaction_hash TEXT UNIQUE,
  expires_at INTEGER NOT NULL,
  settled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_plan_payments_listing ON classified_plan_payments(listing_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS classified_plan_entitlements (
  listing_id TEXT PRIMARY KEY REFERENCES classified_listings(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES classified_plans(code) ON DELETE RESTRICT,
  payment_id TEXT NOT NULL UNIQUE REFERENCES classified_plan_payments(id) ON DELETE RESTRICT,
  active_from TEXT NOT NULL,
  active_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
