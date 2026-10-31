-- Migration 0112 rebuilt external_videos. SQLite rewrote six existing child
-- foreign keys to the temporary table name before it was dropped. Rebuild the
-- children so fresh databases and existing development data both reference the
-- canonical external_videos table.

CREATE TABLE external_videos_before_dailymotion_peertube (
  id TEXT PRIMARY KEY
);
INSERT INTO external_videos_before_dailymotion_peertube (id)
SELECT id FROM external_videos;

CREATE TABLE external_videos_before_tiktok (
  id TEXT PRIMARY KEY
);
INSERT INTO external_videos_before_tiktok (id)
SELECT id FROM external_videos;

CREATE TABLE external_video_playlist_items_fk_repair (
  playlist_id TEXT NOT NULL REFERENCES external_video_playlists(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (playlist_id, video_id),
  CHECK (position >= 0)
);
INSERT INTO external_video_playlist_items_fk_repair SELECT * FROM external_video_playlist_items;
DROP TABLE external_video_playlist_items;
ALTER TABLE external_video_playlist_items_fk_repair RENAME TO external_video_playlist_items;

CREATE TABLE external_video_saves_fk_repair (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, video_id)
);
INSERT INTO external_video_saves_fk_repair SELECT * FROM external_video_saves;
DROP TABLE external_video_saves;
ALTER TABLE external_video_saves_fk_repair RENAME TO external_video_saves;

CREATE TABLE external_video_views_fk_repair (
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  viewer_hash TEXT NOT NULL,
  view_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, viewer_hash, view_date),
  CHECK (length(viewer_hash) = 64),
  CHECK (length(view_date) = 10)
);
INSERT INTO external_video_views_fk_repair SELECT * FROM external_video_views;
DROP TABLE external_video_views;
ALTER TABLE external_video_views_fk_repair RENAME TO external_video_views;

CREATE TABLE video_likes_fk_repair (
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, profile_id)
);
INSERT INTO video_likes_fk_repair SELECT * FROM video_likes;
DROP TABLE video_likes;
ALTER TABLE video_likes_fk_repair RENAME TO video_likes;

CREATE TABLE video_playback_events_fk_repair (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  viewer_hash TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('start', 'quarter', 'half', 'complete', 'skip', 'external')),
  event_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (video_id, viewer_hash, event_type, event_day)
);
INSERT INTO video_playback_events_fk_repair SELECT * FROM video_playback_events;
DROP TABLE video_playback_events;
ALTER TABLE video_playback_events_fk_repair RENAME TO video_playback_events;

CREATE TABLE video_profile_activity_fk_repair (
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
INSERT INTO video_profile_activity_fk_repair SELECT * FROM video_profile_activity;
DROP TABLE video_profile_activity;
ALTER TABLE video_profile_activity_fk_repair RENAME TO video_profile_activity;

CREATE TABLE video_reports_fk_repair (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  UNIQUE (video_id, reporter_profile_id)
);
INSERT INTO video_reports_fk_repair SELECT * FROM video_reports;
DROP TABLE video_reports;
ALTER TABLE video_reports_fk_repair RENAME TO video_reports;

CREATE TABLE video_thread_comments_fk_repair (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  parent_comment_id TEXT,
  profile_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  playback_seconds INTEGER,
  FOREIGN KEY (video_id) REFERENCES external_videos(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_comment_id) REFERENCES video_thread_comments_fk_repair(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
INSERT INTO video_thread_comments_fk_repair SELECT * FROM video_thread_comments;
DROP TABLE video_thread_comments;
ALTER TABLE video_thread_comments_fk_repair RENAME TO video_thread_comments;

CREATE INDEX idx_external_video_views_count ON external_video_views(video_id, created_at DESC);
CREATE INDEX idx_external_video_views_recent ON external_video_views(view_date, video_id);
CREATE INDEX idx_external_video_playlist_items_order ON external_video_playlist_items(playlist_id, position, created_at);
CREATE INDEX idx_external_video_saves_profile ON external_video_saves(profile_id, created_at DESC);
CREATE INDEX idx_external_video_saves_ranking ON external_video_saves(video_id, created_at DESC);
CREATE INDEX video_playback_events_video_day ON video_playback_events(video_id, event_day, event_type);
CREATE INDEX video_profile_activity_recent ON video_profile_activity(profile_id, last_viewed_at DESC);
CREATE INDEX idx_video_thread_comments_video ON video_thread_comments(video_id, status, created_at);

DROP TABLE external_videos_before_dailymotion_peertube;
DROP TABLE external_videos_before_tiktok;
