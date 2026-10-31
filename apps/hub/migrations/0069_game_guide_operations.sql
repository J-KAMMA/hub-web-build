PRAGMA foreign_keys = ON;

ALTER TABLE game_guide_hubs ADD COLUMN image_rights_basis TEXT;
ALTER TABLE game_guide_hubs ADD COLUMN image_attribution TEXT;

CREATE TABLE IF NOT EXISTS game_guide_edit_proposals (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES game_guide_hubs(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  proposed_title TEXT NOT NULL,
  proposed_summary TEXT NOT NULL,
  proposed_aliases TEXT NOT NULL DEFAULT '[]',
  proposed_official_url TEXT,
  proposed_platforms TEXT NOT NULL DEFAULT '[]',
  proposed_release_date TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_game_guide_edit_proposals_queue
  ON game_guide_edit_proposals(status, created_at);

CREATE TABLE IF NOT EXISTS game_guide_updates (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES game_guide_hubs(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  title TEXT NOT NULL,
  official_url TEXT,
  released_at TEXT NOT NULL,
  created_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (game_id, version_label)
);

ALTER TABLE community_guide_pages ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified', 'verified', 'recheck_required'));
ALTER TABLE community_guide_pages ADD COLUMN game_version TEXT;
ALTER TABLE community_guide_pages ADD COLUMN verified_at TEXT;
ALTER TABLE community_guide_pages ADD COLUMN verification_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_guide_pages ADD COLUMN difficulty TEXT;
ALTER TABLE community_guide_pages ADD COLUMN dlc TEXT;
ALTER TABLE community_guide_pages ADD COLUMN mod_environment TEXT;
ALTER TABLE community_guide_pages ADD COLUMN source_url TEXT;

CREATE TABLE IF NOT EXISTS community_guide_verifications (
  page_id TEXT NOT NULL REFERENCES community_guide_pages(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_version TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL,
  PRIMARY KEY (page_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_community_guide_pages_verification
  ON community_guide_pages(verification_status, updated_at DESC);
