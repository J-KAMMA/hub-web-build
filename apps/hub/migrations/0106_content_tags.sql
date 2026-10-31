PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content_tags (
  id TEXT PRIMARY KEY,
  normalized_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0)
);

CREATE TABLE IF NOT EXISTS content_tag_links (
  tag_id TEXT NOT NULL REFERENCES content_tags(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN (
    'social_post', 'thread', 'hubpedia_article', 'community_post',
    'video', 'music', 'product', 'work', 'classified'
  )),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tag_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_content_tag_links_target ON content_tag_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_content_tags_popular ON content_tags(use_count DESC, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS content_tag_link_count_insert
AFTER INSERT ON content_tag_links BEGIN
  UPDATE content_tags SET use_count = use_count + 1, updated_at = NEW.created_at WHERE id = NEW.tag_id;
END;

CREATE TRIGGER IF NOT EXISTS content_tag_link_count_delete
AFTER DELETE ON content_tag_links BEGIN
  UPDATE content_tags SET use_count = max(0, use_count - 1) WHERE id = OLD.tag_id;
END;
