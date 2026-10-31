CREATE TABLE IF NOT EXISTS video_thread_comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  parent_comment_id TEXT,
  profile_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (video_id) REFERENCES external_videos(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_comment_id) REFERENCES video_thread_comments(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_video_thread_comments_video
  ON video_thread_comments(video_id, status, created_at);

CREATE TABLE IF NOT EXISTS video_thread_comment_likes (
  comment_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (comment_id, profile_id),
  FOREIGN KEY (comment_id) REFERENCES video_thread_comments(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_thread_comment_reports (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  reporter_profile_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  UNIQUE (comment_id, reporter_profile_id),
  FOREIGN KEY (comment_id) REFERENCES video_thread_comments(id) ON DELETE CASCADE,
  FOREIGN KEY (reporter_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
