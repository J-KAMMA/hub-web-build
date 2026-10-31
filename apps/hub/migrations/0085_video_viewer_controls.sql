CREATE TABLE IF NOT EXISTS video_profile_activity (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  position_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  volume INTEGER NOT NULL DEFAULT 100,
  muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  last_viewed_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, video_id)
);

CREATE INDEX IF NOT EXISTS video_profile_activity_recent
  ON video_profile_activity(profile_id, last_viewed_at DESC);

CREATE TABLE IF NOT EXISTS video_likes (
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, profile_id)
);

CREATE TABLE IF NOT EXISTS video_reports (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  UNIQUE (video_id, reporter_profile_id)
);

ALTER TABLE video_thread_comments ADD COLUMN playback_seconds INTEGER;
