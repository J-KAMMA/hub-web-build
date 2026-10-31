-- Hub code hosting, phase 1 (docs/hub-software/PLAN.md sections 3.3, 3.4 and 4; AGENTS.md 2026-10-16).
-- Hub owns repository metadata, collaborators, Git access tokens and authorization. The Git data
-- lives in Cloudflare Artifacts behind the Code Worker (apps/code); none of it is stored here.
-- The repository ID is a random UUID and doubles as the Artifacts repository name. No Account
-- identifier, pairwise subject, wallet or plaintext token is stored here.

CREATE TABLE IF NOT EXISTS code_repositories (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  default_branch TEXT NOT NULL DEFAULT 'main',
  state TEXT NOT NULL CHECK (state IN ('provisioning', 'ready')),
  -- Sum of accepted pack sizes (PLAN 4): Artifacts does not report a repository's size.
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS code_repositories_owner_name
  ON code_repositories (owner_profile_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS code_repository_collaborators (
  repo_id TEXT NOT NULL REFERENCES code_repositories(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('read', 'write')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, profile_id)
);

-- Personal Git access tokens: SHA-256 hash only. `repo_id` NULL means every repository the holder
-- owns or collaborates on; the effective access is the lower of the token scope and the role.
CREATE TABLE IF NOT EXISTS code_access_tokens (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  repo_id TEXT REFERENCES code_repositories(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 100),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS code_access_tokens_owner ON code_access_tokens (owner_profile_id, created_at);

-- One row per authorized push: the Account reservation Hub made for it under its own audience,
-- keyed by the write ticket's ID. Committed rows are what the repository holds in Account.
CREATE TABLE IF NOT EXISTS code_repository_pushes (
  jti TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES code_repositories(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reservation_id TEXT NOT NULL,
  max_bytes INTEGER NOT NULL CHECK (max_bytes >= 0),
  bytes INTEGER CHECK (bytes IS NULL OR bytes >= 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'committed', 'released')),
  created_at TEXT NOT NULL,
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS code_repository_pushes_repo ON code_repository_pushes (repo_id, state);
CREATE INDEX IF NOT EXISTS code_repository_pushes_stale ON code_repository_pushes (created_at) WHERE state = 'reserved';
