ALTER TABLE shopping_product_reviews ADD COLUMN review_purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE shopping_product_reviews ADD COLUMN pros TEXT NOT NULL DEFAULT '';
ALTER TABLE shopping_product_reviews ADD COLUMN cons TEXT NOT NULL DEFAULT '';
ALTER TABLE shopping_product_reviews ADD COLUMN disclosure TEXT NOT NULL DEFAULT 'self_purchased'
  CHECK (disclosure IN ('self_purchased', 'gifted', 'monitor', 'seller', 'other'));

CREATE INDEX IF NOT EXISTS idx_shopping_reviews_verified_helpful
  ON shopping_product_reviews(product_id, purchase_verified DESC, updated_at DESC);
