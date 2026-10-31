-- hub.account.bundle v2 に載せる画像（アバター・投稿画像）の公開参照（2026-10-13、DESIGN.md 3）。
-- 束には R2 のオブジェクト鍵を入れない。代わりに推測できない使い捨ての token を発行し、
-- /api/core/portability/media/<token> で配る。配るたびに元の画像がまだ公開されているかを確かめ、期限が来れば 404。
-- 束は移転先の Hub が取りに来るためのもので、期限は短い（7日）。
CREATE TABLE IF NOT EXISTS hub_portable_media_refs (
  token TEXT PRIMARY KEY CHECK (length(token) = 32),
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'post_image', 'post_thumbnail')),
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 5242880),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_portable_media_refs_expiry ON hub_portable_media_refs(expires_at);
CREATE INDEX IF NOT EXISTS idx_hub_portable_media_refs_profile ON hub_portable_media_refs(profile_id);
