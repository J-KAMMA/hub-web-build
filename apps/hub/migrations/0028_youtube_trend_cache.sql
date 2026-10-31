-- Public YouTube discovery cache. This is provider metadata, not a Hub submission.
CREATE TABLE IF NOT EXISTS youtube_trend_videos (
  collection_type TEXT NOT NULL CHECK (collection_type IN ('popular', 'topic')),
  topic_key TEXT NOT NULL,
  topic_label TEXT NOT NULL,
  video_id TEXT NOT NULL CHECK (length(video_id) = 11),
  source_url TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  channel TEXT NOT NULL CHECK (length(channel) BETWEEN 1 AND 300),
  thumbnail_url TEXT,
  published_at TEXT,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50),
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (collection_type, topic_key, video_id)
);

CREATE INDEX IF NOT EXISTS idx_youtube_trend_videos_public
  ON youtube_trend_videos(collection_type, topic_key, expires_at, position);

CREATE TABLE IF NOT EXISTS youtube_trend_refreshes (
  cache_key TEXT PRIMARY KEY CHECK (cache_key = 'youtube-trending'),
  refreshed_at TEXT NOT NULL
);
