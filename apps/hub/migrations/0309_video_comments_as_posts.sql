-- Video comments as posts (docs/hub-video-comments/DESIGN.md, 2026-11-01).
-- A comment on a video is a social_posts row that replies to a video. Columns here:
--   reply_to_video_id          the video; NULL for every other post. A comment's effective gate is its own gate or its video's gate.
--   reply_to_video_seconds     playback position the comment points at.
--   feed_visible               0 keeps a comment out of followers' feeds (the app writes 0 unless the commenter ticks 「フィードにも出す」).
--   hidden_by_target_owner_at  set when the Hub video's owner hides the comment.
--   external_videos.comment_policy  who may comment; only Hub-hosted videos can change it (the app ignores it elsewhere).
--
-- FTS: social_posts_fts is an external-content table, so a 'delete' must carry the indexed values and must only run for
-- rows that are indexed (see 0305). A comment is indexed iff neither its own gate nor its video's gate exists.
-- Order matters: the UPDATE trigger is dropped while reply_to_video_id is backfilled so the backfill does not touch the index.

DROP TRIGGER IF EXISTS social_posts_fts_au;

ALTER TABLE social_posts ADD COLUMN reply_to_video_id TEXT REFERENCES external_videos(id) ON DELETE SET NULL;
ALTER TABLE social_posts ADD COLUMN reply_to_video_seconds INTEGER;
ALTER TABLE social_posts ADD COLUMN feed_visible INTEGER NOT NULL DEFAULT 1 CHECK (feed_visible IN (0, 1));
ALTER TABLE social_posts ADD COLUMN hidden_by_target_owner_at TEXT;
ALTER TABLE external_videos ADD COLUMN comment_policy TEXT NOT NULL DEFAULT 'everyone'
  CHECK (comment_policy IN ('everyone', 'followers', 'nobody'));

-- Posts made from a video page become comments of that video.
UPDATE social_posts
SET reply_to_video_id = (SELECT r.video_id FROM social_post_video_refs r WHERE r.post_id = social_posts.id)
WHERE id IN (SELECT post_id FROM social_post_video_refs);

CREATE INDEX IF NOT EXISTS idx_social_posts_reply_video
  ON social_posts (reply_to_video_id, created_at DESC, id DESC)
  WHERE reply_to_video_id IS NOT NULL;

DROP TRIGGER IF EXISTS social_posts_fts_ai;
DROP TRIGGER IF EXISTS social_posts_fts_ad;
CREATE TRIGGER social_posts_fts_ai AFTER INSERT ON social_posts
WHEN NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = new.id)
 AND (new.reply_to_video_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'video' AND g.target_id = new.reply_to_video_id))
BEGIN
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  VALUES (new.rowid, new.display_name, coalesce(new.handle, ''), new.body);
END;
CREATE TRIGGER social_posts_fts_ad AFTER DELETE ON social_posts
WHEN NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = old.id)
 AND (old.reply_to_video_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'video' AND g.target_id = old.reply_to_video_id))
BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  VALUES ('delete', old.rowid, old.display_name, coalesce(old.handle, ''), old.body);
END;
-- The old and new row can differ in reply_to_video_id (a video delete sets it to NULL), so each half checks its own row.
CREATE TRIGGER social_posts_fts_au AFTER UPDATE ON social_posts
BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  SELECT 'delete', old.rowid, old.display_name, coalesce(old.handle, ''), old.body
  WHERE NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = old.id)
    AND (old.reply_to_video_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'video' AND g.target_id = old.reply_to_video_id));
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  SELECT new.rowid, new.display_name, coalesce(new.handle, ''), new.body
  WHERE NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = new.id)
    AND (new.reply_to_video_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'video' AND g.target_id = new.reply_to_video_id));
END;

-- Attach: take the target's rows out of the index. Detach: put them back.
-- A post gate acts only on a post the video gate does not already hide; a video gate acts only on comments
-- that carry no gate of their own (those were never indexed or were removed by the post-gate trigger).
DROP TRIGGER IF EXISTS content_access_gates_fts_ai;
DROP TRIGGER IF EXISTS content_access_gates_fts_ad;
CREATE TRIGGER content_access_gates_fts_ai AFTER INSERT ON content_access_gates
WHEN new.target_type IN ('post', 'thread', 'video')
BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  SELECT 'delete', p.rowid, p.display_name, coalesce(p.handle, ''), p.body FROM social_posts p
  WHERE new.target_type = 'post' AND p.id = new.target_id
    AND (p.reply_to_video_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM content_access_gates v WHERE v.target_type = 'video' AND v.target_id = p.reply_to_video_id));
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  SELECT 'delete', p.rowid, p.display_name, coalesce(p.handle, ''), p.body FROM social_posts p
  WHERE new.target_type = 'video' AND p.reply_to_video_id = new.target_id
    AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = p.id);
  INSERT INTO thread_posts_fts(thread_posts_fts, rowid, display_name, body)
  SELECT 'delete', tp.rowid, tp.display_name, tp.body FROM thread_posts tp
  WHERE new.target_type = 'thread' AND tp.thread_id = new.target_id;
END;
CREATE TRIGGER content_access_gates_fts_ad AFTER DELETE ON content_access_gates
WHEN old.target_type IN ('post', 'thread', 'video')
BEGIN
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  SELECT p.rowid, p.display_name, coalesce(p.handle, ''), p.body FROM social_posts p
  WHERE old.target_type = 'post' AND p.id = old.target_id
    AND (p.reply_to_video_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM content_access_gates v WHERE v.target_type = 'video' AND v.target_id = p.reply_to_video_id));
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  SELECT p.rowid, p.display_name, coalesce(p.handle, ''), p.body FROM social_posts p
  WHERE old.target_type = 'video' AND p.reply_to_video_id = old.target_id
    AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = p.id);
  INSERT INTO thread_posts_fts(rowid, display_name, body)
  SELECT tp.rowid, tp.display_name, tp.body FROM thread_posts tp
  WHERE old.target_type = 'thread' AND tp.thread_id = old.target_id;
END;

-- Purge comments of videos that are already gated (0305 purged only posts with their own gate).
INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
SELECT 'delete', p.rowid, p.display_name, coalesce(p.handle, ''), p.body
FROM content_access_gates g JOIN social_posts p ON p.reply_to_video_id = g.target_id
WHERE g.target_type = 'video'
  AND NOT EXISTS (SELECT 1 FROM content_access_gates pg WHERE pg.target_type = 'post' AND pg.target_id = p.id);

-- Deleting a gated video would turn ON DELETE SET NULL into "an ungated post with a gated body" (and index it).
-- Its comments go with it instead.
CREATE TRIGGER IF NOT EXISTS external_videos_gated_comments_bd BEFORE DELETE ON external_videos
WHEN EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'video' AND g.target_id = old.id)
BEGIN
  DELETE FROM social_posts WHERE reply_to_video_id = old.id;
END;
