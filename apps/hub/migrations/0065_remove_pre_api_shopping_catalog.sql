-- Remove the manually seeded catalog that preceded the Rakuten and Yahoo API feeds.
-- Live official-API products are preserved even when their titles overlap.
DELETE FROM market_price_offers
WHERE product_key IN (
  'anker-a8309n11-usb-c-hub',
  'logicool-k980gr-solar-keyboard',
  'logicool-kx850fc-mx-mechanical',
  'ohm-ds-ls20bcu-desk-light',
  'strix-sd900-steel-dripper',
  'hario-vcf-02-100w-ten-pack'
);

DELETE FROM market_product_identifiers
WHERE product_key IN (
  'anker-a8309n11-usb-c-hub',
  'logicool-k980gr-solar-keyboard',
  'logicool-kx850fc-mx-mechanical',
  'ohm-ds-ls20bcu-desk-light',
  'strix-sd900-steel-dripper',
  'hario-vcf-02-100w-ten-pack'
);

DELETE FROM market_popularity_events
WHERE product_key IN (
  'anker-a8309n11-usb-c-hub',
  'logicool-k980gr-solar-keyboard',
  'logicool-kx850fc-mx-mechanical',
  'ohm-ds-ls20bcu-desk-light',
  'strix-sd900-steel-dripper',
  'hario-vcf-02-100w-ten-pack'
);

DELETE FROM shopping_product_reviews
WHERE product_id IN (
  'anker-a8309n11-usb-c-hub',
  'logicool-k980gr-solar-keyboard',
  'logicool-kx850fc-mx-mechanical',
  'ohm-ds-ls20bcu-desk-light',
  'strix-sd900-steel-dripper',
  'hario-vcf-02-100w-ten-pack'
);

DELETE FROM market_products
WHERE id IN (
  'anker-a8309n11-usb-c-hub',
  'logicool-k980gr-solar-keyboard',
  'logicool-kx850fc-mx-mechanical',
  'ohm-ds-ls20bcu-desk-light',
  'strix-sd900-steel-dripper',
  'hario-vcf-02-100w-ten-pack'
);
