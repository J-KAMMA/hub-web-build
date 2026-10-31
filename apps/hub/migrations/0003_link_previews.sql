CREATE TABLE IF NOT EXISTS link_previews (
  normalized_url TEXT PRIMARY KEY NOT NULL,
  final_url TEXT NOT NULL,
  site_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS link_previews_expires_at_idx ON link_previews (expires_at);
