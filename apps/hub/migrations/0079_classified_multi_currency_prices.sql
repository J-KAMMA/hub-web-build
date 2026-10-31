ALTER TABLE classified_plan_entitlements RENAME TO classified_plan_entitlements_old;
ALTER TABLE classified_plan_payments RENAME TO classified_plan_payments_old;

CREATE TABLE classified_plan_payments (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE RESTRICT,
  payer_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  plan_code TEXT NOT NULL REFERENCES classified_plans(code) ON DELETE RESTRICT,
  network TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USDC', 'JPYC')),
  asset TEXT NOT NULL,
  amount_atomic TEXT NOT NULL CHECK (length(amount_atomic) > 0),
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'failed', 'refund_review')),
  transaction_hash TEXT UNIQUE,
  expires_at INTEGER NOT NULL,
  settled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO classified_plan_payments
  (id, listing_id, payer_profile_id, plan_code, network, currency, asset, amount_atomic, amount_jpy, status, transaction_hash, expires_at, settled_at, created_at, updated_at)
SELECT id, listing_id, payer_profile_id, plan_code, network, 'USDC', asset, CAST(amount_usdc_atomic AS TEXT), amount_jpy, status, transaction_hash, expires_at, settled_at, created_at, updated_at
FROM classified_plan_payments_old;

CREATE TABLE classified_plan_entitlements (
  listing_id TEXT PRIMARY KEY REFERENCES classified_listings(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES classified_plans(code) ON DELETE RESTRICT,
  payment_id TEXT NOT NULL UNIQUE REFERENCES classified_plan_payments(id) ON DELETE RESTRICT,
  active_from TEXT NOT NULL,
  active_until TEXT NOT NULL,
  activated_at TEXT,
  publication_ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO classified_plan_entitlements
  (listing_id, plan_code, payment_id, active_from, active_until, activated_at, publication_ends_at, created_at, updated_at)
SELECT listing_id, plan_code, payment_id, active_from, active_until, activated_at, publication_ends_at, created_at, updated_at
FROM classified_plan_entitlements_old;

DROP TABLE classified_plan_entitlements_old;
DROP TABLE classified_plan_payments_old;
CREATE INDEX idx_classified_plan_payments_listing ON classified_plan_payments(listing_id, status, created_at DESC);

CREATE TABLE classified_listing_prices (
  kind TEXT NOT NULL CHECK (kind IN ('real-estate', 'vehicles')),
  currency TEXT NOT NULL CHECK (currency IN ('USDC', 'JPYC')),
  amount_major INTEGER NOT NULL CHECK (amount_major > 0),
  renewal_amount_major INTEGER NOT NULL CHECK (renewal_amount_major > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (kind, currency)
);

INSERT INTO classified_listing_prices (kind, currency, amount_major, renewal_amount_major) VALUES
  ('real-estate', 'JPYC', 500, 300),
  ('vehicles', 'JPYC', 300, 200),
  ('real-estate', 'USDC', 5, 3),
  ('vehicles', 'USDC', 3, 2);
