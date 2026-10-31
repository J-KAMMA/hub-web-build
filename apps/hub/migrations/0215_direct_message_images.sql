-- DM の画像添付。social_post_images（0069 + 0072 + 0105 + 0203 ほか）と同型だが、
-- 付け先は direct_messages(id) への外部キー。投稿用の表は post_id が post を指さない
-- 形に直した経緯（0203）があるので、DM は最初から専用の表にする。
-- メッセージが消えると画像行も連鎖で消える。

CREATE TABLE IF NOT EXISTS direct_message_images (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES direct_messages(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  width INTEGER NOT NULL CHECK (width > 0 AND width <= 4096),
  height INTEGER NOT NULL CHECK (height > 0 AND height <= 4096),
  alt_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected', 'deleted')),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  safety_status TEXT NOT NULL DEFAULT 'clean'
    CHECK (safety_status IN ('pending', 'clean', 'sensitive', 'rejected')),
  safety_labels_json TEXT NOT NULL DEFAULT '[]',
  reviewed_at TEXT,
  thumbnail_object_key TEXT,
  thumbnail_byte_size INTEGER CHECK (thumbnail_byte_size IS NULL OR (thumbnail_byte_size > 0 AND thumbnail_byte_size <= 524288)),
  thumbnail_width INTEGER CHECK (thumbnail_width IS NULL OR (thumbnail_width > 0 AND thumbnail_width <= 480)),
  thumbnail_height INTEGER CHECK (thumbnail_height IS NULL OR (thumbnail_height > 0 AND thumbnail_height <= 480)),
  metadata_stripped_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_direct_message_images_message
  ON direct_message_images(message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_direct_message_images_owner_status
  ON direct_message_images(owner_profile_id, status, created_at DESC);
