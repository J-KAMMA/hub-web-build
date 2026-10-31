-- Price observations for the public shopping comparison surface.
-- Only official APIs, merchant feeds, or manually verified retailer pages are
-- accepted. Checkout, customer, order, and payment data do not belong here.
CREATE TABLE IF NOT EXISTS market_price_offers (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL CHECK (length(product_key) BETWEEN 1 AND 100),
  shop_id TEXT NOT NULL CHECK (length(shop_id) BETWEEN 1 AND 100),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  shipping_minor INTEGER CHECK (shipping_minor IS NULL OR shipping_minor >= 0),
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND currency = upper(currency)
  ),
  tax_included INTEGER NOT NULL DEFAULT 0 CHECK (tax_included IN (0, 1)),
  availability TEXT NOT NULL DEFAULT 'unknown'
    CHECK (availability IN ('in_stock', 'out_of_stock', 'unknown')),
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('official_api', 'merchant_feed', 'manual_verified')),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_key, shop_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_market_price_offers_product_expiry
  ON market_price_offers(product_key, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_price_offers_shop_expiry
  ON market_price_offers(shop_id, expires_at DESC);
