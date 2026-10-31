-- Keep the original broad category column for compatibility with existing
-- D1 constraints, and store the user-facing shopping category separately.
ALTER TABLE market_products ADD COLUMN shopping_category TEXT
  CHECK (
    shopping_category IS NULL OR shopping_category IN (
      'electronics', 'books', 'living', 'food', 'creator',
      'fashion', 'beauty', 'sports', 'hobby', 'baby', 'pet'
    )
  );

UPDATE market_products
SET shopping_category = category
WHERE shopping_category IS NULL;

CREATE INDEX IF NOT EXISTS idx_market_products_shopping_category
  ON market_products(shopping_category, status, region, language, sort_order);
