CREATE TABLE IF NOT EXISTS profile_recovery_claims (
  token_hash TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS profile_recovery_claims_profile_idx
  ON profile_recovery_claims(profile_id, expires_at);
