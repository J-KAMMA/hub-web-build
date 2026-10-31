CREATE TABLE IF NOT EXISTS video_playback_events (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  viewer_hash TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('start', 'quarter', 'half', 'complete', 'skip', 'external')),
  event_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (video_id, viewer_hash, event_type, event_day)
);

CREATE INDEX IF NOT EXISTS video_playback_events_video_day
  ON video_playback_events(video_id, event_day, event_type);
