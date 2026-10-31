-- Unified tag links (2026-10-29). One link table for every Hub-owned kind, keyed by the shared
-- @jkamma/content-tags key. public_visible is 1 only while the target is publicly listable
-- (published / not moderated / public audience / no gate / publicly listable video origin / author not suspended). Triggers maintain it so every write
-- path (gate attach and detach, moderation hide, publish and unpublish, audience change, link
-- insert) flips it inside the same statement. Tag listings read public_visible = 1 AND still
-- apply the gate exclusion. Keys are re-normalised by scripts/backfill-tag-index.mjs (SQLite has no NFKC).

PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS content_tag_link_count_insert;
DROP TRIGGER IF EXISTS content_tag_link_count_delete;
DROP INDEX IF EXISTS idx_content_tag_links_target;
DROP INDEX IF EXISTS idx_content_tag_links_signal;

ALTER TABLE content_tag_links RENAME TO content_tag_links_old;

CREATE TABLE content_tag_links (
  tag_id TEXT NOT NULL REFERENCES content_tags(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN (
    'social_post', 'thread', 'hubpedia_article', 'community_post',
    'video', 'music', 'product', 'work', 'classified',
    'user_article', 'music_work', 'market_product'
  )),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  tag_kind TEXT NOT NULL DEFAULT 'manual',
  confidence REAL NOT NULL DEFAULT 1 CHECK(confidence >= 0 AND confidence <= 1),
  provenance TEXT NOT NULL DEFAULT 'publisher',
  generation_basis TEXT NOT NULL DEFAULT 'legacy-tag',
  classifier_version TEXT NOT NULL DEFAULT 'legacy',
  public_visible INTEGER NOT NULL DEFAULT 1 CHECK (public_visible IN (0, 1)),
  PRIMARY KEY (tag_id, target_type, target_id)
);

INSERT INTO content_tag_links (tag_id, target_type, target_id, created_at, tag_kind, confidence, provenance, generation_basis, classifier_version, public_visible)
SELECT tag_id, target_type, target_id, created_at, tag_kind, confidence, provenance, generation_basis, classifier_version, 1
FROM content_tag_links_old;

DROP TABLE content_tag_links_old;

CREATE INDEX idx_content_tag_links_target ON content_tag_links(target_type, target_id);
CREATE INDEX idx_content_tag_links_signal ON content_tag_links(target_type, target_id, confidence DESC, tag_kind);
CREATE INDEX idx_content_tag_links_listing ON content_tag_links(tag_id, public_visible, created_at DESC, target_id);

-- Initial flags for the rows that exist today.
UPDATE content_tag_links SET public_visible = CASE WHEN (CASE content_tag_links.target_type WHEN 'social_post' THEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id)) WHEN 'thread' THEN (EXISTS (SELECT 1 FROM threads s WHERE s.id=content_tag_links.target_id AND s.moderation_status='active' AND s.status<>'archived' AND s.merged_into_thread_id IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='thread' AND g.target_id=content_tag_links.target_id)) WHEN 'user_article' THEN (EXISTS (SELECT 1 FROM hub_user_articles s WHERE s.id=content_tag_links.target_id AND s.status='published' AND s.audience='general' AND s.moderated_at IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='article' AND g.target_id=content_tag_links.target_id)) WHEN 'video' THEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) WHEN 'music_work' THEN (EXISTS (SELECT 1 FROM music_works s WHERE s.id=content_tag_links.target_id AND s.status='active')) WHEN 'market_product' THEN (EXISTS (SELECT 1 FROM market_products s WHERE s.id=content_tag_links.target_id AND s.status='published')) WHEN 'classified' THEN (EXISTS (SELECT 1 FROM classified_listings s WHERE s.id=content_tag_links.target_id AND s.status='published')) WHEN 'work' THEN (EXISTS (SELECT 1 FROM work_listings s WHERE s.id=content_tag_links.target_id AND s.status='published')) ELSE 1 END) THEN 1 ELSE 0 END;

-- use_count = number of visible links.
UPDATE content_tags SET use_count = (SELECT COUNT(*) FROM content_tag_links l WHERE l.tag_id = content_tags.id AND l.public_visible = 1);

-- A new link gets its flag from the target's current state; use_count follows the final flag.
CREATE TRIGGER content_tag_link_after_insert
AFTER INSERT ON content_tag_links BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (CASE NEW.target_type WHEN 'social_post' THEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=NEW.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=NEW.target_id)) WHEN 'thread' THEN (EXISTS (SELECT 1 FROM threads s WHERE s.id=NEW.target_id AND s.moderation_status='active' AND s.status<>'archived' AND s.merged_into_thread_id IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='thread' AND g.target_id=NEW.target_id)) WHEN 'user_article' THEN (EXISTS (SELECT 1 FROM hub_user_articles s WHERE s.id=NEW.target_id AND s.status='published' AND s.audience='general' AND s.moderated_at IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='article' AND g.target_id=NEW.target_id)) WHEN 'video' THEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=NEW.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=NEW.target_id)) WHEN 'music_work' THEN (EXISTS (SELECT 1 FROM music_works s WHERE s.id=NEW.target_id AND s.status='active')) WHEN 'market_product' THEN (EXISTS (SELECT 1 FROM market_products s WHERE s.id=NEW.target_id AND s.status='published')) WHEN 'classified' THEN (EXISTS (SELECT 1 FROM classified_listings s WHERE s.id=NEW.target_id AND s.status='published')) WHEN 'work' THEN (EXISTS (SELECT 1 FROM work_listings s WHERE s.id=NEW.target_id AND s.status='published')) ELSE 1 END) THEN 1 ELSE 0 END
    WHERE tag_id = NEW.tag_id AND target_type = NEW.target_type AND target_id = NEW.target_id;
  UPDATE content_tags SET use_count = (SELECT COUNT(*) FROM content_tag_links l WHERE l.tag_id = NEW.tag_id AND l.public_visible = 1), updated_at = NEW.created_at WHERE id = NEW.tag_id;
END;

CREATE TRIGGER content_tag_link_after_delete
AFTER DELETE ON content_tag_links BEGIN
  UPDATE content_tags SET use_count = (SELECT COUNT(*) FROM content_tag_links l WHERE l.tag_id = OLD.tag_id AND l.public_visible = 1) WHERE id = OLD.tag_id;
END;

CREATE TRIGGER content_tag_link_after_visibility
AFTER UPDATE OF public_visible ON content_tag_links
WHEN NEW.public_visible <> OLD.public_visible BEGIN
  UPDATE content_tags SET use_count = (SELECT COUNT(*) FROM content_tag_links l WHERE l.tag_id = NEW.tag_id AND l.public_visible = 1) WHERE id = NEW.tag_id;
END;

-- Target state changes re-evaluate the flag of that target's links.
CREATE TRIGGER content_tag_visibility_social_post
AFTER UPDATE OF moderated_at, audience, author_profile_id ON social_posts BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_thread
AFTER UPDATE OF moderation_status, status, merged_into_thread_id ON threads BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM threads s WHERE s.id=content_tag_links.target_id AND s.moderation_status='active' AND s.status<>'archived' AND s.merged_into_thread_id IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='thread' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'thread' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_user_article
AFTER UPDATE OF status, audience, moderated_at ON hub_user_articles BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM hub_user_articles s WHERE s.id=content_tag_links.target_id AND s.status='published' AND s.audience='general' AND s.moderated_at IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='article' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'user_article' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_video
AFTER UPDATE OF status, ingest_source ON external_videos BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_music_work
AFTER UPDATE OF status ON music_works BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM music_works s WHERE s.id=content_tag_links.target_id AND s.status='active')) THEN 1 ELSE 0 END
    WHERE target_type = 'music_work' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_market_product
AFTER UPDATE OF status ON market_products BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM market_products s WHERE s.id=content_tag_links.target_id AND s.status='published')) THEN 1 ELSE 0 END
    WHERE target_type = 'market_product' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_classified
AFTER UPDATE OF status ON classified_listings BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM classified_listings s WHERE s.id=content_tag_links.target_id AND s.status='published')) THEN 1 ELSE 0 END
    WHERE target_type = 'classified' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_work
AFTER UPDATE OF status ON work_listings BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM work_listings s WHERE s.id=content_tag_links.target_id AND s.status='published')) THEN 1 ELSE 0 END
    WHERE target_type = 'work' AND target_id = NEW.id;
END;

-- Hub self-made videos share the catalog row's id; their listing depends on hub_videos.
CREATE TRIGGER content_tag_visibility_hub_video
AFTER UPDATE OF state, visibility, age_restricted, hold_reason ON hub_videos BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_hub_video_insert
AFTER INSERT ON hub_videos BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = NEW.id;
END;

CREATE TRIGGER content_tag_visibility_hub_video_delete
AFTER DELETE ON hub_videos BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = OLD.id;
END;

-- Auto-ingested videos inherit the audience of the posts that carry them.
CREATE TRIGGER content_tag_visibility_video_origin_insert
AFTER INSERT ON social_post_video_origins BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = NEW.video_id;
END;

CREATE TRIGGER content_tag_visibility_video_origin_delete
AFTER DELETE ON social_post_video_origins BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = OLD.video_id;
END;

CREATE TRIGGER content_tag_visibility_video_ref_insert
AFTER INSERT ON social_post_video_refs BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = NEW.video_id;
END;

CREATE TRIGGER content_tag_visibility_video_ref_delete
AFTER DELETE ON social_post_video_refs BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = OLD.video_id;
END;

CREATE TRIGGER content_tag_visibility_video_by_post
AFTER UPDATE OF audience, moderated_at ON social_posts BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id IN (
      SELECT video_id FROM social_post_video_origins WHERE post_id = NEW.id
      UNION SELECT video_id FROM social_post_video_refs WHERE post_id = NEW.id);
END;

CREATE TRIGGER content_tag_visibility_author_suspension_insert
AFTER INSERT ON profile_moderation_status BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id IN (SELECT id FROM social_posts WHERE author_profile_id = NEW.profile_id);
END;

CREATE TRIGGER content_tag_visibility_author_suspension_update
AFTER UPDATE OF status ON profile_moderation_status BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id IN (SELECT id FROM social_posts WHERE author_profile_id = NEW.profile_id);
END;

CREATE TRIGGER content_tag_visibility_author_suspension_delete
AFTER DELETE ON profile_moderation_status BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id IN (SELECT id FROM social_posts WHERE author_profile_id = OLD.profile_id);
END;

CREATE TRIGGER content_tag_gate_insert_post
AFTER INSERT ON content_access_gates WHEN NEW.target_type = 'post' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id = NEW.target_id;
END;

CREATE TRIGGER content_tag_gate_delete_post
AFTER DELETE ON content_access_gates WHEN OLD.target_type = 'post' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM social_posts s WHERE s.id=content_tag_links.target_id AND s.moderated_at IS NULL AND s.audience='public' AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='post' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'social_post' AND target_id = OLD.target_id;
END;

CREATE TRIGGER content_tag_gate_insert_article
AFTER INSERT ON content_access_gates WHEN NEW.target_type = 'article' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM hub_user_articles s WHERE s.id=content_tag_links.target_id AND s.status='published' AND s.audience='general' AND s.moderated_at IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='article' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'user_article' AND target_id = NEW.target_id;
END;

CREATE TRIGGER content_tag_gate_delete_article
AFTER DELETE ON content_access_gates WHEN OLD.target_type = 'article' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM hub_user_articles s WHERE s.id=content_tag_links.target_id AND s.status='published' AND s.audience='general' AND s.moderated_at IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='article' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'user_article' AND target_id = OLD.target_id;
END;

CREATE TRIGGER content_tag_gate_insert_video
AFTER INSERT ON content_access_gates WHEN NEW.target_type = 'video' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = NEW.target_id;
END;

CREATE TRIGGER content_tag_gate_delete_video
AFTER DELETE ON content_access_gates WHEN OLD.target_type = 'video' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM external_videos s WHERE s.id=content_tag_links.target_id AND s.status='active' AND ((s.ingest_source <> 'social_post' OR EXISTS (SELECT 1 FROM social_post_video_origins origin JOIN social_posts origin_post ON origin_post.id = origin.post_id WHERE origin.video_id = s.id AND origin_post.audience = 'public' AND origin_post.moderated_at IS NULL) OR EXISTS (SELECT 1 FROM social_post_video_refs ref JOIN social_posts ref_post ON ref_post.id = ref.post_id WHERE ref.video_id = s.id AND ref_post.audience = 'public' AND ref_post.moderated_at IS NULL)) AND (NOT EXISTS (SELECT 1 FROM hub_videos native WHERE native.id = s.id AND NOT (native.state = 'published' AND native.hold_reason IS NULL AND native.visibility = 'public' AND native.age_restricted = 0))))) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='video' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'video' AND target_id = OLD.target_id;
END;

CREATE TRIGGER content_tag_gate_insert_thread
AFTER INSERT ON content_access_gates WHEN NEW.target_type = 'thread' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM threads s WHERE s.id=content_tag_links.target_id AND s.moderation_status='active' AND s.status<>'archived' AND s.merged_into_thread_id IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='thread' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'thread' AND target_id = NEW.target_id;
END;

CREATE TRIGGER content_tag_gate_delete_thread
AFTER DELETE ON content_access_gates WHEN OLD.target_type = 'thread' BEGIN
  UPDATE content_tag_links SET public_visible = CASE WHEN (EXISTS (SELECT 1 FROM threads s WHERE s.id=content_tag_links.target_id AND s.moderation_status='active' AND s.status<>'archived' AND s.merged_into_thread_id IS NULL) AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type='thread' AND g.target_id=content_tag_links.target_id)) THEN 1 ELSE 0 END
    WHERE target_type = 'thread' AND target_id = OLD.target_id;
END;

-- A deleted target removes its links (the delete trigger on links keeps use_count right).
CREATE TRIGGER content_tag_target_deleted_social_post
AFTER DELETE ON social_posts BEGIN
  DELETE FROM content_tag_links WHERE target_type = 'social_post' AND target_id = OLD.id;
END;

CREATE TRIGGER content_tag_target_deleted_thread
AFTER DELETE ON threads BEGIN
  DELETE FROM content_tag_links WHERE target_type = 'thread' AND target_id = OLD.id;
END;

CREATE TRIGGER content_tag_target_deleted_user_article
AFTER DELETE ON hub_user_articles BEGIN
  DELETE FROM content_tag_links WHERE target_type = 'user_article' AND target_id = OLD.id;
END;

CREATE TRIGGER content_tag_target_deleted_video
AFTER DELETE ON external_videos BEGIN
  DELETE FROM content_tag_links WHERE target_type = 'video' AND target_id = OLD.id;
END;

CREATE TRIGGER content_tag_target_deleted_music_work
AFTER DELETE ON music_works BEGIN
  DELETE FROM content_tag_links WHERE target_type = 'music_work' AND target_id = OLD.id;
END;

CREATE TRIGGER content_tag_target_deleted_market_product
AFTER DELETE ON market_products BEGIN
  DELETE FROM content_tag_links WHERE target_type = 'market_product' AND target_id = OLD.id;
END;

CREATE TRIGGER content_tag_target_deleted_classified
AFTER DELETE ON classified_listings BEGIN
  DELETE FROM content_tag_links WHERE target_type = 'classified' AND target_id = OLD.id;
END;

CREATE TRIGGER content_tag_target_deleted_work
AFTER DELETE ON work_listings BEGIN
  DELETE FROM content_tag_links WHERE target_type = 'work' AND target_id = OLD.id;
END;
