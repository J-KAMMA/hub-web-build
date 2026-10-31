PRAGMA foreign_keys = ON;

-- Hub-local pseudonymous credentials only. Never add email, phone, legal identity,
-- Identity-service IDs, wallet IDs, or cross-service mappings to this table.
CREATE TABLE IF NOT EXISTS profile_credentials (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(password_salt) BETWEEN 20 AND 64),
  CHECK (length(password_hash) BETWEEN 40 AND 128),
  CHECK (password_iterations >= 100000)
);
