CREATE TABLE IF NOT EXISTS thread_summary_revisions (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 20 AND 12000),
  source TEXT NOT NULL CHECK(source IN ('automatic','community','moderator')),
  status TEXT NOT NULL CHECK(status IN ('proposed','published','rejected','superseded')),
  created_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(thread_id, revision_no)
);
CREATE INDEX IF NOT EXISTS idx_thread_summary_revision_status ON thread_summary_revisions(thread_id,status,revision_no DESC);

CREATE TABLE IF NOT EXISTS thread_post_quality_votes (
  post_id TEXT NOT NULL REFERENCES thread_posts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK(dimension IN ('helpful','agree')),
  value INTEGER NOT NULL CHECK(value IN (-1,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(post_id,profile_id,dimension)
);
CREATE INDEX IF NOT EXISTS idx_thread_quality_votes_post ON thread_post_quality_votes(post_id,dimension,value);

CREATE TABLE IF NOT EXISTS thread_topic_subscriptions (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('board','tag','language','region')),
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(profile_id,kind,value)
);

CREATE TABLE IF NOT EXISTS thread_operational_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('created','first_reply','resolved','correction','summary_published','report_opened','report_resolved','continued')),
  post_id TEXT REFERENCES thread_posts(id) ON DELETE SET NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_operational_events_type ON thread_operational_events(event_type,occurred_at DESC);

CREATE TABLE IF NOT EXISTS thread_reading_archive (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  archived_at TEXT NOT NULL,
  PRIMARY KEY(thread_id,profile_id)
);
