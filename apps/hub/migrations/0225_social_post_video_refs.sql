-- 動画ページから作ったポストの参照表。動画ごとにポストを新しい順で引く。
CREATE TABLE IF NOT EXISTS social_post_video_refs (
  post_id TEXT PRIMARY KEY REFERENCES social_posts(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_social_post_video_refs_video
  ON social_post_video_refs (video_id, created_at DESC, post_id);
