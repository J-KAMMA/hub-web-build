-- Product matching metadata for approved official APIs and merchant feeds.
-- This stores public catalog identifiers only; it contains no customer,
-- checkout, order, payment, account, or identity data.
CREATE TABLE IF NOT EXISTS market_product_identifiers (
  product_key TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,
  region TEXT NOT NULL CHECK (region IN ('jp', 'na', 'kr', 'zh')),
  identifier_kind TEXT NOT NULL
    CHECK (identifier_kind IN ('gtin', 'brand_model')),
  normalized_value TEXT NOT NULL CHECK (length(normalized_value) BETWEEN 3 AND 220),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_key, identifier_kind, normalized_value),
  UNIQUE (identifier_kind, normalized_value, region)
);

CREATE INDEX IF NOT EXISTS idx_market_product_identifiers_product
  ON market_product_identifiers(product_key, identifier_kind);

CREATE TABLE IF NOT EXISTS market_feed_imports (
  id TEXT PRIMARY KEY,
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 1 AND 500),
  identifier_match_count INTEGER NOT NULL DEFAULT 0 CHECK (identifier_match_count >= 0),
  fuzzy_match_count INTEGER NOT NULL DEFAULT 0 CHECK (fuzzy_match_count >= 0),
  new_draft_count INTEGER NOT NULL DEFAULT 0 CHECK (new_draft_count >= 0),
  ambiguous_draft_count INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous_draft_count >= 0),
  created_at TEXT NOT NULL
);
