ALTER TABLE thread_post_quality_votes RENAME TO thread_post_quality_votes_expanded;

CREATE TABLE thread_post_quality_votes (
  post_id TEXT NOT NULL REFERENCES thread_posts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK(dimension IN ('helpful','primary_source','outdated')),
  value INTEGER NOT NULL CHECK(value IN (-1,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(post_id,profile_id,dimension)
);

INSERT OR IGNORE INTO thread_post_quality_votes(post_id,profile_id,dimension,value,created_at,updated_at)
SELECT post_id,profile_id,dimension,value,created_at,updated_at
FROM thread_post_quality_votes_expanded
WHERE dimension IN ('helpful','primary_source','outdated');

DROP TABLE thread_post_quality_votes_expanded;
CREATE INDEX idx_thread_quality_votes_post ON thread_post_quality_votes(post_id,dimension,value);
