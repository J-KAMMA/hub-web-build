CREATE TABLE IF NOT EXISTS market_price_history (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  shipping_minor INTEGER CHECK (shipping_minor IS NULL OR shipping_minor >= 0),
  currency TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (availability IN ('in_stock', 'out_of_stock', 'unknown')),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_key) REFERENCES market_products(id) ON DELETE CASCADE,
  UNIQUE (product_key, shop_id, currency, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_market_price_history_product
  ON market_price_history(product_key, currency, observed_at DESC);

CREATE TABLE IF NOT EXISTS shopping_price_alerts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  target_total_minor INTEGER NOT NULL CHECK (target_total_minor >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_notified_total_minor INTEGER,
  last_notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES market_products(id) ON DELETE CASCADE,
  UNIQUE (profile_id, product_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_shopping_price_alerts_active
  ON shopping_price_alerts(active, product_id, currency);

CREATE TABLE IF NOT EXISTS shopping_product_reports (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  reporter_profile_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('wrong_product', 'wrong_price', 'broken_link', 'unavailable', 'prohibited', 'other')),
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (product_id) REFERENCES market_products(id) ON DELETE CASCADE,
  FOREIGN KEY (reporter_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_product_reports_status
  ON shopping_product_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS shopping_review_reactions (
  review_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  helpful INTEGER NOT NULL DEFAULT 1 CHECK (helpful = 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (review_id, profile_id),
  FOREIGN KEY (review_id) REFERENCES shopping_product_reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shopping_review_reports (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  reporter_profile_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'false_information', 'conflict_of_interest', 'other')),
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (review_id) REFERENCES shopping_product_reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (reporter_profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE (review_id, reporter_profile_id)
);

