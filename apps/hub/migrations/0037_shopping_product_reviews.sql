CREATE TABLE IF NOT EXISTS shopping_product_reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, profile_id),
  FOREIGN KEY (product_id) REFERENCES market_products(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_product_reviews_product
  ON shopping_product_reviews(product_id, status, updated_at DESC);
