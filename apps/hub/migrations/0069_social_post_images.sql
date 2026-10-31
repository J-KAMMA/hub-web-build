CREATE TABLE IF NOT EXISTS social_post_images (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES social_posts(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  width INTEGER NOT NULL CHECK (width > 0 AND width <= 4096),
  height INTEGER NOT NULL CHECK (height > 0 AND height <= 4096),
  alt_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected', 'deleted')),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_social_post_images_post
  ON social_post_images(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_social_post_images_owner_created
  ON social_post_images(owner_profile_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_post_images_owner_hash
  ON social_post_images(owner_profile_id, content_hash)
  WHERE status <> 'deleted';
