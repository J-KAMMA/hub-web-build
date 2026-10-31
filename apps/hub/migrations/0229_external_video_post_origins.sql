-- 投稿から自動追加した動画が、どの投稿に載っていたかの記録。
-- ingest_source = 'social_post' の動画は、公開かつ未モデレートの投稿が1件でも
-- ここに結び付いている間だけ公開カタログに出す（lib/server/video-public-origin.ts）。
-- フォロワー限定の投稿のリンクが公開カタログへ漏れるのを防ぐ。
CREATE TABLE IF NOT EXISTS social_post_video_origins (
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, post_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_social_post_video_origins_post
  ON social_post_video_origins (post_id);

-- 既存行の補完。投稿と動画の結び付きは当時記録していないので、
-- 同じ投稿者の、取り込み直前の10分以内の投稿で、本文に動画IDを含むものを起点とみなす。
-- (author_profile_id, created_at) の索引を使うので全件の総当たりにはならない。
-- 結び付かなかった旧行は公開側から外れたまま（安全側）。同じ動画が公開で再投稿されれば復帰する。
INSERT OR IGNORE INTO social_post_video_origins (video_id, post_id, created_at)
SELECT v.id, p.id, p.created_at
FROM external_videos v
JOIN social_posts p
  ON p.author_profile_id = v.submitted_by_profile_id
 AND p.created_at <= v.created_at
 AND p.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', v.created_at, '-10 minutes')
WHERE v.ingest_source = 'social_post'
  AND length(v.external_video_id) >= 5
  AND instr(p.body, v.external_video_id) > 0;
