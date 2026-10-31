ALTER TABLE thread_post_quality_votes RENAME TO thread_post_quality_votes_legacy;

CREATE TABLE thread_post_quality_votes (
  post_id TEXT NOT NULL REFERENCES thread_posts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK(dimension IN ('helpful','detailed','primary_source','current','outdated')),
  value INTEGER NOT NULL CHECK(value IN (-1,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(post_id,profile_id,dimension)
);

INSERT OR IGNORE INTO thread_post_quality_votes(post_id,profile_id,dimension,value,created_at,updated_at)
SELECT post_id,profile_id,'helpful',value,created_at,updated_at
FROM thread_post_quality_votes_legacy
WHERE dimension IN ('helpful','agree');

DROP TABLE thread_post_quality_votes_legacy;
CREATE INDEX idx_thread_quality_votes_post ON thread_post_quality_votes(post_id,dimension,value);

CREATE TABLE IF NOT EXISTS thread_category_operation_notes (
  board_key TEXT PRIMARY KEY,
  recommendation TEXT NOT NULL CHECK(recommendation IN ('keep','merge','split','rename')),
  note TEXT NOT NULL DEFAULT '',
  updated_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
