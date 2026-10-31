PRAGMA foreign_keys = ON;

-- Hub stores public catalog metadata and official provider URLs only.
-- Audio files, provider accounts, subscriptions and payment data stay with providers.
CREATE TABLE IF NOT EXISTS music_works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  description TEXT NOT NULL,
  genre TEXT NOT NULL,
  release_year INTEGER NOT NULL,
  submitted_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(title) BETWEEN 1 AND 180),
  CHECK (length(artist) BETWEEN 1 AND 120),
  CHECK (length(description) BETWEEN 1 AND 500),
  CHECK (length(genre) BETWEEN 1 AND 60),
  CHECK (release_year BETWEEN 1000 AND 3000),
  CHECK (status IN ('active', 'removed'))
);

CREATE TABLE IF NOT EXISTS music_service_links (
  id TEXT PRIMARY KEY,
  music_work_id TEXT NOT NULL REFERENCES music_works(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL,
  embed_url TEXT,
  created_at TEXT NOT NULL,
  CHECK (provider IN ('spotify', 'youtube', 'soundcloud', 'apple', 'amazon', 'bandcamp')),
  CHECK (length(source_url) BETWEEN 1 AND 2048),
  CHECK (embed_url IS NULL OR length(embed_url) <= 2048),
  UNIQUE (music_work_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_music_works_public ON music_works(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_works_submitter ON music_works(submitted_by_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_service_links_work ON music_service_links(music_work_id);
