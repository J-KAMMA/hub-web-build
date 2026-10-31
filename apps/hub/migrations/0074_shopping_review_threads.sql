ALTER TABLE shopping_product_reviews ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE shopping_product_reviews ADD COLUMN usage_period TEXT;
ALTER TABLE shopping_product_reviews ADD COLUMN purchase_shop TEXT;
ALTER TABLE shopping_product_reviews ADD COLUMN purchase_price_minor INTEGER;
ALTER TABLE shopping_product_reviews ADD COLUMN purchase_verified INTEGER NOT NULL DEFAULT 0 CHECK (purchase_verified IN (0, 1));

CREATE TABLE IF NOT EXISTS shopping_review_replies (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (review_id) REFERENCES shopping_product_reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_review_replies_review
  ON shopping_review_replies(review_id, status, created_at ASC);
