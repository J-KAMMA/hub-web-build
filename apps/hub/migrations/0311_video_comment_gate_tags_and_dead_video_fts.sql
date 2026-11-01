-- Tags of a comment on a gated video must not leak (docs/hub-video-comments/DESIGN.md, review finding).
-- 1) content_tag_links.public_visible for a social_post target now also requires that the post's video (reply_to_video_id) has no gate.
--    The 0286 triggers are recreated with that extra clause; video-gate attach/detach re-evaluates that video's comments.
-- 2) The gate-delete FTS restore skips videos that are not active or are deleted/taken down, so removing the gate of a dead video
--    never re-indexes its comments (the app also deletes the comments first).

DROP TRIGGER IF EXISTS content_access_gates_fts_ad;
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
    AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = p.id)
    AND EXISTS (SELECT 1 FROM external_videos ev WHERE ev.id = old.target_id AND ev.status = 'active'
                AND NOT EXISTS (SELECT 1 FROM hub_videos h WHERE h.id = ev.id AND (h.state = 'deleted' OR h.hold_reason IS NOT NULL)));
  INSERT INTO thread_posts_fts(rowid, display_name, body)
  SELECT tp.rowid, tp.display_name, tp.body FROM thread_posts tp
  WHERE old.target_type = 'thread' AND tp.thread_id = old.target_id;
END;

DROP TRIGGER IF EXISTS content_tag_link_after_insert;
DROP TRIGGER IF EXISTS content_tag_visibility_social_post;
DROP TRIGGER IF EXISTS content_tag_visibility_author_suspension_insert;
DROP TRIGGER IF EXISTS content_tag_visibility_author_suspension_update;
DROP TRIGGER IF EXISTS content_tag_visibility_author_suspension_delete;
DROP TRIGGER IF EXISTS content_tag_gate_insert_post;
DROP TRIGGER IF EXISTS content_tag_gate_delete_post;
DROP TRIGGER IF EXISTS content_tag_gate_insert_video_comments;
DROP TRIGGER IF EXISTS content_tag_gate_delete_video_comments;

CREATE TRIGGER content_tag_link_after_insert
AFTER INSERT ON content_tag_links BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (CASE NEW.target_type WHEN 'social_post' THEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=NEW.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=NEW.target_id) AND NOT EXISTS (SELECT 1 FROM content_access_gates vg JOIN social_posts vsp ON vg.target_type='video' AND vg.target_id=vsp.reply_to_video_id WHERE vsp.id=NEW.target_id)) WHEN 'thread' THEN (EXISTS (SELECT 1 FROM threads s WHERE s.id=NEW.target_id AND s.moderation_status='active' AND s.status<>'archived' AND s.merged_into_thread_id IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='thread' AND g.target_id=NEW.target_id)) WHEN 'user_article' THEN (EXISTS (SELECT 1 FROM hub_user_articles s WHERE s.id=NEW.target_id AND s.status='published' AND s.audience='general' AND s.moderated_at IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='article' AND g.target_id=NEW.target_id)) WHEN 'video' THEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=NEW.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=NEW.target_id)) WHEN 'music_work' THEN (EXISTS (SELECT 1 FROM music_works s WHERE s.id=NEW.target_id AND s.status='active')) WHEN 'market_product' THEN (EXISTS (SELECT 1 FROM market_products s WHERE s.id=NEW.target_id AND s.status='published')) WHEN 'classified' THEN (EXISTS (SELECT 1 FROM classified_listings s WHERE s.id=NEW.target_id AND s.status='published')) WHEN 'work' THEN (EXISTS (SELECT 1 FROM work_listings s WHERE s.id=NEW.target_id AND s.status='published')) ELSE 1 END) THEN 1 ELSE 0 END
    WHERE tag_id = NEW.tag_id AND target_type = NEW.target_type AND target_id = NEW.target_id;
  UPDATE content_tags SET use_count = (SELECT COUNT(*) FROM content_tag_links l WHERE l.tag_id = NEW.tag_id AND l.public_visible = 1), updated_at = NEW.created_at WHERE id = NEW.tag_id;
END;

CREATE TRIGGER content_tag_visibility_social_post
AFTER UPDATE OF moderated_at, audience, author_profile_id, reply_to_video_id ON social_posts BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id) AND NOT EXISTS (SELECT 1 FROM content_access_gates vg JOIN social_posts vsp ON vg.target_type='video' AND vg.target_id=vsp.reply_to_video_id WHERE vsp.id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_author_suspension_insert
AFTER INSERT ON profile_moderation_status BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id) AND NOT EXISTS (SELECT 1 FROM content_access_gates vg JOIN social_posts vsp ON vg.target_type='video' AND vg.target_id=vsp.reply_to_video_id WHERE vsp.id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id IN (SELECT id FROM social_posts WHERE author_profile_id = NEW.profile_id);
END;

CREATE TRIGGER content_tag_visibility_author_suspension_update
AFTER UPDATE OF status ON profile_moderation_status BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id) AND NOT EXISTS (SELECT 1 FROM content_access_gates vg JOIN social_posts vsp ON vg.target_type='video' AND vg.target_id=vsp.reply_to_video_id WHERE vsp.id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id IN (SELECT id FROM social_posts WHERE author_profile_id = NEW.profile_id);
END;

CREATE TRIGGER content_tag_visibility_author_suspension_delete
AFTER DELETE ON profile_moderation_status BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id) AND NOT EXISTS (SELECT 1 FROM content_access_gates vg JOIN social_posts vsp ON vg.target_type='video' AND vg.target_id=vsp.reply_to_video_id WHERE vsp.id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id IN (SELECT id FROM social_posts WHERE author_profile_id = OLD.profile_id);
END;

CREATE TRIGGER content_tag_gate_insert_post
AFTER INSERT ON content_access_gates WHEN NEW.target_type = 'post' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id) AND NOT EXISTS (SELECT 1 FROM content_access_gates vg JOIN social_posts vsp ON vg.target_type='video' AND vg.target_id=vsp.reply_to_video_id WHERE vsp.id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id = NEW.target_id;
END;

CREATE TRIGGER content_tag_gate_delete_post
AFTER DELETE ON content_access_gates WHEN OLD.target_type = 'post' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id) AND NOT EXISTS (SELECT 1 FROM content_access_gates vg JOIN social_posts vsp ON vg.target_type='video' AND vg.target_id=vsp.reply_to_video_id WHERE vsp.id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id = OLD.target_id;
END;

CREATE TRIGGER content_tag_gate_insert_video_comments
AFTER INSERT ON content_access_gates WHEN NEW.target_type = 'video' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id) AND NOT EXISTS (SELECT 1 FROM content_access_gates vg JOIN social_posts vsp ON vg.target_type='video' AND vg.target_id=vsp.reply_to_video_id WHERE vsp.id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id IN (SELECT id FROM social_posts WHERE reply_to_video_id = NEW.target_id);
END;

CREATE TRIGGER content_tag_gate_delete_video_comments
AFTER DELETE ON content_access_gates WHEN OLD.target_type = 'video' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id) AND NOT EXISTS (SELECT 1 FROM content_access_gates vg JOIN social_posts vsp ON vg.target_type='video' AND vg.target_id=vsp.reply_to_video_id WHERE vsp.id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id IN (SELECT id FROM social_posts WHERE reply_to_video_id = OLD.target_id);
END;

-- One-time repair for comments of videos that are already gated.
UPDATE content_tag_links SET public_visible = 0
WHERE target_type = 'social_post' AND public_visible = 1
  AND target_id IN (SELECT p.id FROM social_posts p JOIN content_access_gates g ON g.target_type = 'video' AND g.target_id = p.reply_to_video_id);
