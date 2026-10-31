-- social_post_images.post_id が social_posts(id) への外部キーだったため、
-- コミュニティのメッセージとスレッドの返信に画像を付けると
-- publishImages（post_id にメッセージの id を書く）が
-- SQLITE_CONSTRAINT_FOREIGNKEY で落ち、投稿の API が400を返していた
-- （2026-09-02、v2 の欄から送って判明。既存の欄も同じ経路）。
-- 画像は社交投稿・スレッド返信・コミュニティのメッセージの3種に付くので、
-- post_id は特定の表を指さない。SQLite は外部キーを後から外せないので、
-- 表を作り直して中身を移す。列と検査は現状の定義（0069 + 0072 + 0105 ほか）のまま。
-- 社交投稿を消したときの連鎖削除は無くなるので、削除側で status を 'deleted' にする
-- （コミュニティは既にそうしている）。

CREATE TABLE IF NOT EXISTS social_post_images_v2 (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id TEXT,
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

INSERT OR IGNORE INTO social_post_images_v2 (
  id, owner_profile_id, post_id, object_key, mime_type, byte_size, width, height, alt_text, status,
  content_hash, created_at, published_at, safety_status, safety_labels_json, reviewed_at,
  thumbnail_object_key, thumbnail_byte_size, thumbnail_width, thumbnail_height, metadata_stripped_at
)
SELECT
  id, owner_profile_id, post_id, object_key, mime_type, byte_size, width, height, alt_text, status,
  content_hash, created_at, published_at, safety_status, safety_labels_json, reviewed_at,
  thumbnail_object_key, thumbnail_byte_size, thumbnail_width, thumbnail_height, metadata_stripped_at
FROM social_post_images;

DROP INDEX IF EXISTS idx_social_post_images_post;
DROP INDEX IF EXISTS idx_social_post_images_owner_created;
DROP INDEX IF EXISTS idx_social_post_images_owner_hash;
DROP INDEX IF EXISTS idx_social_post_images_thumbnail_key;
DROP TABLE social_post_images;
ALTER TABLE social_post_images_v2 RENAME TO social_post_images;

CREATE INDEX IF NOT EXISTS idx_social_post_images_post
  ON social_post_images(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_social_post_images_owner_created
  ON social_post_images(owner_profile_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_post_images_owner_hash
  ON social_post_images(owner_profile_id, content_hash)
  WHERE status <> 'deleted';
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_post_images_thumbnail_key
  ON social_post_images(thumbnail_object_key)
  WHERE thumbnail_object_key IS NOT NULL;
