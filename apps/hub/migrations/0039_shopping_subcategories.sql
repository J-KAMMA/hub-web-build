ALTER TABLE market_products ADD COLUMN shopping_subcategory TEXT
  CHECK (
    shopping_subcategory IS NULL OR shopping_subcategory IN (
      'smartphones', 'computers', 'cameras', 'audio-video', 'gaming',
      'books', 'stationery', 'office', 'kitchen', 'lighting', 'furniture',
      'diy-tools', 'garden', 'automotive', 'travel', 'groceries', 'beverages',
      'coffee-tea', 'food-gifts', 'art-prints', 'digital-goods', 'clothing',
      'bags-shoes', 'watches-jewelry', 'skincare', 'cosmetics', 'health-care',
      'fitness', 'outdoor', 'games', 'toys', 'instruments', 'collectibles',
      'baby-care', 'kids-fashion', 'educational-toys', 'pet-food', 'pet-care'
    )
  );

UPDATE market_products
SET shopping_subcategory = CASE
  WHEN id IN (
    'anker-a8309n11-usb-c-hub',
    'logicool-k980gr-solar-keyboard',
    'logicool-kx850fc-mx-mechanical'
  ) THEN 'computers'
  WHEN id = 'ohm-ds-ls20bcu-desk-light' THEN 'lighting'
  WHEN id IN (
    'strix-sd900-steel-dripper',
    'hario-vcf-02-100w-ten-pack'
  ) THEN 'coffee-tea'
  ELSE shopping_subcategory
END;

CREATE INDEX IF NOT EXISTS idx_market_products_shopping_subcategory
  ON market_products(shopping_category, shopping_subcategory, status, region, language);
