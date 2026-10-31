PRAGMA foreign_keys = ON;

-- Hub-local playback counts. The viewer hash is derived from a random,
-- host-only Hub cookie and is used only to deduplicate one view per day.
CREATE TABLE IF NOT EXISTS external_video_views (
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  viewer_hash TEXT NOT NULL,
  view_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, viewer_hash, view_date),
  CHECK (length(viewer_hash) = 64),
  CHECK (length(view_date) = 10)
);

CREATE INDEX IF NOT EXISTS idx_external_video_views_count
  ON external_video_views(video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_video_views_recent
  ON external_video_views(view_date, video_id);
