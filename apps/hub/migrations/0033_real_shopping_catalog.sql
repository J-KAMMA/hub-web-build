-- Initial real-product catalog, manually verified against official retailer pages.
-- Prices remain observations, not guarantees. Refresh or archive stale rows.
-- Rebuild the table to replace a GLOB constraint that newer workerd rejects and
-- add an optional official product-image URL.
ALTER TABLE market_products RENAME TO market_products_legacy;

CREATE TABLE market_products (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  category TEXT NOT NULL CHECK (category IN ('electronics', 'books', 'living', 'food', 'creator')),
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
  color TEXT NOT NULL DEFAULT '#d7f238' CHECK (length(color) = 7 AND substr(color, 1, 1) = '#'),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  shop_id TEXT NOT NULL CHECK (length(shop_id) BETWEEN 1 AND 100),
  source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO market_products (
  id, title, category, region, language, price_minor, currency, rating, review_count,
  seller, description, delivery_label, badge, image_url, icon, color, featured,
  shop_id, source_url, status, sort_order, created_at, updated_at
)
SELECT id, title, category, region, language, price_minor, currency, rating, review_count,
  seller, description, delivery_label, badge, NULL, icon, color, featured,
  shop_id, source_url, status, sort_order, created_at, updated_at
FROM market_products_legacy;

DROP TABLE market_products_legacy;
CREATE INDEX idx_market_products_public ON market_products(status, region, language, sort_order, updated_at DESC);
CREATE INDEX idx_market_products_shop ON market_products(shop_id, status, updated_at DESC);

INSERT INTO market_products (
  id, title, category, region, language, price_minor, currency, rating, review_count,
  seller, description, delivery_label, badge, image_url, icon, color, featured, shop_id,
  source_url, status, sort_order, created_at, updated_at
) VALUES
  ('anker-a8309n11-usb-c-hub', 'Anker USB-C データ ハブ（4-in-1, 5Gbps）A8309N11', 'electronics', 'jp', 'ja', 1590, 'JPY', 4.33, 3, 'Anker', 'USB-Cポート1つを4つのUSB 5Gbpsポートへ拡張できる、約35gのコンパクトなデータハブ。', '2026/7/16 税込価格確認・在庫は公式ページで確認', '実データ', 'https://image.yodobashi.com/product/100/000/001/008/212/674/100000001008212674_10204.jpg', 'USB', '#d9e7ff', 1, 'yodobashi', 'https://www.yodobashi.com/ec/product/100000001008212674/', 'published', 10, '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('logicool-k980gr-solar-keyboard', 'Logicool Signature Slim Solar＋ K980 ソーラー充電キーボード', 'electronics', 'jp', 'ja', 16390, 'JPY', 5, 2, 'Logicool', '自然光と人工光を利用するLogi LightChargeを搭載した、静かなパンタグラフ式ワイヤレスキーボード。', '2026/7/16 税込価格確認・在庫は公式ページで確認', '実データ', 'https://image.yodobashi.com/product/100/000/001/009/510/649/100000001009510649_10204.jpg', 'KB', '#e5e7eb', 1, 'yodobashi', 'https://www.yodobashi.com/product/100000001009510649/', 'published', 20, '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('logicool-kx850fc-mx-mechanical', 'Logicool MX MECHANICAL 青軸 KX850FC', 'electronics', 'jp', 'ja', 24640, 'JPY', 4.88, 17, 'Logicool', 'ロープロファイルキーとスマートイルミネーションを備えた、クリッキー青軸のワイヤレスメカニカルキーボード。', '2026/7/16 税込価格確認・在庫は公式ページで確認', NULL, 'https://image.yodobashi.com/product/100/000/001/007/117/299/100000001007117299_10204.jpg', 'MX', '#dfe3e6', 0, 'yodobashi', 'https://www.yodobashi.com/product/100000001007117299/', 'published', 30, '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('ohm-ds-ls20bcu-desk-light', 'オーム電機 LEDデスクライト DS-LS20BCU-WD', 'living', 'jp', 'ja', 3920, 'JPY', 5, 5, 'オーム電機', '5段階調光、平均演色性Ra93、約1000ルーメン。給電用USBポートを備えたデスクライト。', '2026/7/16 税込価格確認・在庫は公式ページで確認', NULL, 'https://image.yodobashi.com/product/100/000/001/008/322/049/100000001008322049_10204.jpg', 'LED', '#fff0b8', 0, 'yodobashi', 'https://www.yodobashi.com/product/100000001008322049/', 'published', 40, '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('strix-sd900-steel-dripper', 'STRIX DESIGN ステンレス コーヒードリッパー 101 SD-900', 'food', 'jp', 'ja', 1750, 'JPY', 0, 0, 'STRIX DESIGN', '二層ステンレスフィルターを採用し、ペーパーフィルターなしで使える1〜2杯用ドリッパー。', '2026/7/16 税込価格確認・お取り寄せ', NULL, 'https://image.yodobashi.com/product/100/000/001/006/837/552/100000001006837552_10204.jpg', '珈琲', '#ded0c5', 0, 'yodobashi', 'https://www.yodobashi.com/product/100000001006837552/', 'published', 50, '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
  ('hario-vcf-02-100w-ten-pack', 'HARIO V60用ペーパーフィルター 02W 100枚 ×10個セット', 'food', 'jp', 'ja', 3150, 'JPY', 0, 0, 'HARIO', 'V60の1〜4杯用円すい形ペーパーフィルター、100枚入り10個のまとめ買いセット。', '2026/7/16 税込価格確認・在庫は公式ページで確認', NULL, 'https://image.yodobashi.com/product/200/000/000/100/227/489/200000000100227489_10204.jpg', 'V60', '#f1e8d8', 0, 'yodobashi', 'https://www.yodobashi.com/product/200000000100227489/', 'published', 60, '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title, category = excluded.category, region = excluded.region,
  language = excluded.language, price_minor = excluded.price_minor, currency = excluded.currency,
  rating = excluded.rating, review_count = excluded.review_count, seller = excluded.seller,
  description = excluded.description, delivery_label = excluded.delivery_label,
  badge = excluded.badge, image_url = excluded.image_url, icon = excluded.icon, color = excluded.color,
  featured = excluded.featured, shop_id = excluded.shop_id, source_url = excluded.source_url,
  status = excluded.status, sort_order = excluded.sort_order, updated_at = excluded.updated_at;

INSERT INTO market_price_offers (
  id, product_key, shop_id, amount_minor, shipping_minor, currency, tax_included,
  availability, source_kind, source_url, observed_at, expires_at, created_at, updated_at
) SELECT
  'verified:' || id || ':yodobashi', id, 'yodobashi', price_minor, 0, 'JPY', 1,
  CASE WHEN id = 'strix-sd900-steel-dripper' THEN 'unknown' ELSE 'in_stock' END,
  'manual_verified', source_url, '2026-07-16T00:00:00.000Z',
  '2026-07-23T00:00:00.000Z', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z'
FROM market_products
WHERE id IN (
  'anker-a8309n11-usb-c-hub', 'logicool-k980gr-solar-keyboard',
  'logicool-kx850fc-mx-mechanical', 'ohm-ds-ls20bcu-desk-light',
  'strix-sd900-steel-dripper', 'hario-vcf-02-100w-ten-pack'
)
ON CONFLICT(product_key, shop_id, currency) DO UPDATE SET
  amount_minor = excluded.amount_minor, shipping_minor = excluded.shipping_minor,
  tax_included = excluded.tax_included, availability = excluded.availability,
  source_kind = excluded.source_kind, source_url = excluded.source_url,
  observed_at = excluded.observed_at, expires_at = excluded.expires_at,
  updated_at = excluded.updated_at;
