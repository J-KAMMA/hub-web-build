PRAGMA foreign_keys = ON;

-- Guide directories are community-local navigation. They are not chat
-- channels, BBS threads, filesystem paths, or storage object keys.
CREATE TABLE IF NOT EXISTS community_guide_directories (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  parent_directory_id TEXT REFERENCES community_guide_directories(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (community_id, parent_directory_id, slug),
  CHECK (length(slug) BETWEEN 1 AND 80),
  CHECK (length(name) BETWEEN 1 AND 80),
  CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS idx_community_guide_directories_order
  ON community_guide_directories(
    community_id,
    parent_directory_id,
    position,
    created_at
  );

ALTER TABLE community_guide_pages
  ADD COLUMN directory_id TEXT
  REFERENCES community_guide_directories(id) ON DELETE SET NULL;

ALTER TABLE community_guide_proposals
  ADD COLUMN proposed_directory_id TEXT
  REFERENCES community_guide_directories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_community_guide_pages_directory
  ON community_guide_pages(community_id, directory_id, updated_at DESC);
