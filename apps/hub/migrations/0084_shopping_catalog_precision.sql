PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS market_product_variants (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,
  variant_group_key TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT,
  size TEXT,
  capacity TEXT,
  pack_count INTEGER CHECK (pack_count IS NULL OR pack_count > 0),
  condition TEXT NOT NULL DEFAULT 'new' CHECK (condition IN ('new', 'used', 'refurbished', 'preorder')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (variant_group_key, label, condition)
);

CREATE INDEX IF NOT EXISTS idx_market_product_variants_product
  ON market_product_variants(product_key, variant_group_key);

ALTER TABLE market_price_offers ADD COLUMN point_reward_minor INTEGER NOT NULL DEFAULT 0 CHECK (point_reward_minor >= 0);
ALTER TABLE market_price_offers ADD COLUMN member_only INTEGER NOT NULL DEFAULT 0 CHECK (member_only IN (0, 1));
ALTER TABLE market_price_offers ADD COLUMN coupon_required INTEGER NOT NULL DEFAULT 0 CHECK (coupon_required IN (0, 1));

CREATE TABLE IF NOT EXISTS shopping_price_anomalies (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  product_key TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('too_low', 'too_high', 'currency_mismatch', 'negative_effective_price')),
  observed_amount_minor INTEGER NOT NULL,
  reference_amount_minor INTEGER,
  status TEXT NOT NULL DEFAULT 'quarantined' CHECK (status IN ('quarantined', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (offer_id, reason)
);
