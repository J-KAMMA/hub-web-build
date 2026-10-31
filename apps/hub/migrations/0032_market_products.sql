-- Hub-owned shopping product master. Product discovery data belongs to Hub;
-- checkout, customer, address, order, and payment data must not be stored here.
CREATE TABLE IF NOT EXISTS market_products (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  category TEXT NOT NULL
    CHECK (category IN ('electronics', 'books', 'living', 'food', 'creator')),
  region TEXT NOT NULL CHECK (region IN ('jp', 'na', 'kr', 'zh')),
  language TEXT NOT NULL CHECK (language IN ('ja', 'en', 'ko', 'zh-CN')),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  rating REAL NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  seller TEXT NOT NULL CHECK (length(seller) BETWEEN 1 AND 160),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  delivery_label TEXT NOT NULL CHECK (length(delivery_label) BETWEEN 1 AND 160),
  badge TEXT CHECK (badge IS NULL OR length(badge) <= 40),
  image_url TEXT CHECK (image_url IS NULL OR image_url LIKE 'https://%'),
  icon TEXT NOT NULL DEFAULT 'J' CHECK (length(icon) BETWEEN 1 AND 12),
  color TEXT NOT NULL DEFAULT '#d7f238'
    CHECK (length(color) = 7 AND substr(color, 1, 1) = '#'),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  shop_id TEXT NOT NULL CHECK (length(shop_id) BETWEEN 1 AND 100),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_products_public
  ON market_products(status, region, language, sort_order, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_products_shop
  ON market_products(shop_id, status, updated_at DESC);
