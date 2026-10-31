-- Original uploads are discarded client-side. Only metadata-stripped derivatives are stored.
ALTER TABLE social_post_images ADD COLUMN thumbnail_object_key TEXT;
ALTER TABLE social_post_images ADD COLUMN thumbnail_byte_size INTEGER CHECK (thumbnail_byte_size IS NULL OR (thumbnail_byte_size > 0 AND thumbnail_byte_size <= 524288));
ALTER TABLE social_post_images ADD COLUMN thumbnail_width INTEGER CHECK (thumbnail_width IS NULL OR (thumbnail_width > 0 AND thumbnail_width <= 480));
ALTER TABLE social_post_images ADD COLUMN thumbnail_height INTEGER CHECK (thumbnail_height IS NULL OR (thumbnail_height > 0 AND thumbnail_height <= 480));
ALTER TABLE social_post_images ADD COLUMN metadata_stripped_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_post_images_thumbnail_key ON social_post_images(thumbnail_object_key) WHERE thumbnail_object_key IS NOT NULL;
