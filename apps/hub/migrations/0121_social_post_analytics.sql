CREATE TABLE IF NOT EXISTS social_post_analytics_events (
  event_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('viewable_impression', 'link_transition')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_social_post_analytics_post_type_created
  ON social_post_analytics_events(post_id, event_type, created_at);

