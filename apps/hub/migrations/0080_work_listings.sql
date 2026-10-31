CREATE TABLE IF NOT EXISTS work_listings (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'request', 'job')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  compensation_label TEXT NOT NULL,
  budget_amount INTEGER CHECK (budget_amount IS NULL OR budget_amount > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'rejected')),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_listings_public ON work_listings(status, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_listings_owner ON work_listings(owner_profile_id, updated_at DESC);
