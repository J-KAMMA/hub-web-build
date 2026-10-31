-- Manufacturer-hosted images are not reusable merely because their source is official.
-- Remove them until an image is supplied under merchant API display terms.
UPDATE market_products
SET image_url = NULL,
    image_source_url = NULL,
    image_source_kind = NULL,
    updated_at = '2026-07-16T00:00:00.000Z'
WHERE image_source_kind = 'manufacturer';
