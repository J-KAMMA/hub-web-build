-- Tags for market listings (2026-10-29). Source of record is tags_json (display forms, at most 8 of 32 characters);
-- matching goes through content_tag_links (target types market_product and classified).

ALTER TABLE market_products ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array');

ALTER TABLE classified_listings ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array');
