-- Replace retailer-hotlinked images with manufacturer-provided product media.
-- Provenance is stored separately so unapproved image origins can fail closed.
ALTER TABLE market_products ADD COLUMN image_source_url TEXT
  CHECK (image_source_url IS NULL OR image_source_url LIKE 'https://%');
ALTER TABLE market_products ADD COLUMN image_source_kind TEXT
  CHECK (image_source_kind IS NULL OR image_source_kind IN ('manufacturer', 'merchant_api'));

UPDATE market_products SET
  image_url = 'https://www.ankerjapan.com/cdn/shop/files/A8309-BLACK.jpg?v=1700016220&width=1200',
  image_source_url = 'https://www.ankerjapan.com/products/a8309n11',
  image_source_kind = 'manufacturer', updated_at = '2026-07-16T00:00:00.000Z'
WHERE id = 'anker-a8309n11-usb-c-hub';

UPDATE market_products SET
  image_url = 'https://content.presspage.com/uploads/2712/93b521e2-74ff-48d7-a851-3b573d27a374/1920_high_resolution_png-k980universalgraphitetopjp.png?10000=',
  image_source_url = 'https://press.logicool.co.jp/ja-jp/k980/',
  image_source_kind = 'manufacturer', updated_at = '2026-07-16T00:00:00.000Z'
WHERE id = 'logicool-k980gr-solar-keyboard';

UPDATE market_products SET
  image_url = 'https://resource.logitech.com/w_544%2Ch_466%2Car_7%3A6%2Cc_pad%2Cq_auto%2Cf_auto%2Cdpr_1.0/d_transparent.gif/content/dam/logitech/en/products/keyboards/mx-mechanical/migration-assets-for-delorean-2025/gallery/mx-mechanical-top-view-graphite-jp.png',
  image_source_url = 'https://www.logicool.co.jp/ja-jp/shop/p/mx-mechanical',
  image_source_kind = 'manufacturer', updated_at = '2026-07-16T00:00:00.000Z'
WHERE id = 'logicool-kx850fc-mx-mechanical';

UPDATE market_products SET
  image_url = 'https://www.ohm-electric.co.jp/wp/wp-content/uploads/2025/11/06384800-360x360.jpg',
  image_source_url = 'https://www.ohm-electric.co.jp/product/c01/c0102/878820/',
  image_source_kind = 'manufacturer', updated_at = '2026-07-16T00:00:00.000Z'
WHERE id = 'ohm-ds-ls20bcu-desk-light';

UPDATE market_products SET
  image_url = 'https://strixdesign.jp/wp-content/uploads/2018/05/8925ceac367aa10567d6d6ae875d8e25.jpg',
  image_source_url = 'https://strixdesign.jp/featured_item/sd-900/',
  image_source_kind = 'manufacturer', updated_at = '2026-07-16T00:00:00.000Z'
WHERE id = 'strix-sd900-steel-dripper';

UPDATE market_products SET
  image_url = 'https://hario-asia-official.com/cdn/shop/products/VCF-02-100W.png?v=1640920939&width=1445',
  image_source_url = 'https://shop.hariocorp.co.jp/products/vcf-02-100w-cp',
  image_source_kind = 'manufacturer', updated_at = '2026-07-16T00:00:00.000Z'
WHERE id = 'hario-vcf-02-100w-ten-pack';
