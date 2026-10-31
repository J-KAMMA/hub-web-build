CREATE TABLE research_git_repositories (
  project_id TEXT PRIMARY KEY REFERENCES research_projects(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'confidential' CHECK(visibility IN ('public','confidential')),
  created_at TEXT NOT NULL
);
CREATE TABLE research_git_tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_git_repositories(project_id) ON DELETE CASCADE,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK(scope IN ('read','write')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX research_git_tokens_project ON research_git_tokens(project_id,expires_at);
