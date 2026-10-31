PRAGMA foreign_keys = ON;

ALTER TABLE game_guide_hubs ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('pending', 'published', 'rejected'));
ALTER TABLE game_guide_hubs ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
ALTER TABLE game_guide_hubs ADD COLUMN official_url TEXT;
ALTER TABLE game_guide_hubs ADD COLUMN platforms TEXT NOT NULL DEFAULT '[]';
ALTER TABLE game_guide_hubs ADD COLUMN release_date TEXT;
ALTER TABLE game_guide_hubs ADD COLUMN created_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE game_guide_hubs ADD COLUMN reviewed_at TEXT;
ALTER TABLE game_guide_hubs ADD COLUMN reviewed_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_game_guide_hubs_status_updated
  ON game_guide_hubs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS game_guide_submission_audit (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES game_guide_hubs(id) ON DELETE CASCADE,
  actor_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('submitted', 'published', 'rejected', 'community_linked')),
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_guide_submission_audit_game
  ON game_guide_submission_audit(game_id, created_at DESC);
