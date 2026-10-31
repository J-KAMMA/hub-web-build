CREATE TABLE research_pdfs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
  visibility TEXT NOT NULL DEFAULT 'confidential' CHECK(visibility IN ('public','confidential')),
  version INTEGER NOT NULL CHECK(version >= 1),
  series_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 10485760),
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK(scan_status IN ('pending','clean','rejected','failed')),
  created_at TEXT NOT NULL,
  UNIQUE(series_id,version)
);
CREATE INDEX research_pdfs_project ON research_pdfs(project_id,created_at DESC);
