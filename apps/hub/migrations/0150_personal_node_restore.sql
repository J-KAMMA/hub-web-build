CREATE TABLE IF NOT EXISTS personal_node_restore_events (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_created_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','already_present','skipped','conflict')),
  restored_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, event_hash)
);

CREATE INDEX IF NOT EXISTS idx_personal_node_restore_profile_time
  ON personal_node_restore_events(profile_id, restored_at DESC);
