-- Same-model, multi-shop price observations verified on 2026-07-16.
-- Shipping uses Tokyo as the destination where it varies. NULL prevents an unsupported total.
INSERT INTO market_price_offers (
  id, product_key, shop_id, amount_minor, shipping_minor, currency, tax_included,
  availability, source_kind, source_url, observed_at, expires_at, created_at, updated_at
) VALUES
  ('verified:anker-a8309n11-usb-c-hub:yodobashi', 'anker-a8309n11-usb-c-hub', 'yodobashi', 1590, 0, 'JPY', 1, 'in_stock', 'manual_verified', 'https://www.yodobashi.com/ec/product/100000001008212674/', '2026-07-16T00:00:00.000Z', '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('verified:anker-a8309n11-usb-c-hub:rakuten', 'anker-a8309n11-usb-c-hub', 'rakuten', 1748, 550, 'JPY', 1, 'in_stock', 'manual_verified', 'https://item.rakuten.co.jp/e-bear/4571411212697/', '2026-07-16T00:00:00.000Z', '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('verified:logicool-kx850fc-mx-mechanical:rakuten', 'logicool-kx850fc-mx-mechanical', 'rakuten', 22400, 0, 'JPY', 1, 'in_stock', 'manual_verified', 'https://product.rakuten.co.jp/product/-/702b063f279428fd75c9e2e01cb274d8/', '2026-07-16T00:00:00.000Z', '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('verified:logicool-kx850fc-mx-mechanical:yodobashi', 'logicool-kx850fc-mx-mechanical', 'yodobashi', 24640, 0, 'JPY', 1, 'in_stock', 'manual_verified', 'https://www.yodobashi.com/product/100000001007117299/', '2026-07-16T00:00:00.000Z', '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('verified:logicool-kx850fc-mx-mechanical:yahoo-shopping', 'logicool-kx850fc-mx-mechanical', 'yahoo-shopping', 26980, 0, 'JPY', 1, 'in_stock', 'manual_verified', 'https://shopping.yahoo.co.jp/products/174e0119c8', '2026-07-16T00:00:00.000Z', '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('verified:ohm-ds-ls20bcu-desk-light:yodobashi', 'ohm-ds-ls20bcu-desk-light', 'yodobashi', 3920, 0, 'JPY', 1, 'in_stock', 'manual_verified', 'https://www.yodobashi.com/product/100000001008322049/', '2026-07-16T00:00:00.000Z', '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('verified:ohm-ds-ls20bcu-desk-light:rakuten', 'ohm-ds-ls20bcu-desk-light', 'rakuten', 4464, 0, 'JPY', 1, 'in_stock', 'manual_verified', 'https://item.rakuten.co.jp/zakkagenesis/1000000103659/', '2026-07-16T00:00:00.000Z', '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('verified:hario-vcf-02-100w-ten-pack:yodobashi', 'hario-vcf-02-100w-ten-pack', 'yodobashi', 3150, 0, 'JPY', 1, 'in_stock', 'manual_verified', 'https://www.yodobashi.com/product/200000000100227489/', '2026-07-16T00:00:00.000Z', '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('verified:hario-vcf-02-100w-ten-pack:yahoo-shopping', 'hario-vcf-02-100w-ten-pack', 'yahoo-shopping', 2849, NULL, 'JPY', 1, 'unknown', 'manual_verified', 'https://shopping.yahoo.co.jp/products/3ba8bcfd8a', '2026-07-16T00:00:00.000Z', '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z')
ON CONFLICT(product_key, shop_id, currency) DO UPDATE SET
  id = excluded.id, amount_minor = excluded.amount_minor,
  shipping_minor = excluded.shipping_minor, tax_included = excluded.tax_included,
  availability = excluded.availability, source_kind = excluded.source_kind,
  source_url = excluded.source_url, observed_at = excluded.observed_at,
  expires_at = excluded.expires_at, updated_at = excluded.updated_at;
