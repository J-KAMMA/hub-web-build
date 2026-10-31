-- 音楽作品ページから作ったポストの参照表。作品ごとにポストを新しい順で引く。
-- work_id は Music カタログ側の公開作品ID。Hubの表ではないのでFKは張らず、書く時に検証する。
CREATE TABLE IF NOT EXISTS social_post_music_refs (
  post_id TEXT PRIMARY KEY REFERENCES social_posts(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_post_music_refs_work
  ON social_post_music_refs (work_id, created_at DESC, post_id);
