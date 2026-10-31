PRAGMA foreign_keys = ON;

-- Account remains the assertion issuer. Hub stores only its audience-specific
-- opaque subject and never receives the common Account identifier.
CREATE TABLE IF NOT EXISTS account_profile_links (
  pairwise_subject TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL,
  last_authenticated_at TEXT NOT NULL,
  CHECK (length(pairwise_subject) BETWEEN 32 AND 128)
);

CREATE TABLE IF NOT EXISTS account_assertion_replays (
  assertion_jti TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  CHECK (length(assertion_jti) = 36)
);

CREATE INDEX IF NOT EXISTS idx_account_assertion_replays_expiry
  ON account_assertion_replays(expires_at);
