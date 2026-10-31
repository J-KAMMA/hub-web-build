PRAGMA foreign_keys = ON;

-- Hub-local pseudonymous passkeys. Credential public keys are not cross-service
-- identifiers and must never be joined to Identity, Vault, Music, email, or wallet data.
CREATE TABLE IF NOT EXISTS profile_passkeys (
  credential_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  CHECK (length(credential_id) BETWEEN 16 AND 2048),
  CHECK (length(public_key) BETWEEN 16 AND 4096),
  CHECK (counter >= 0),
  CHECK (device_type IN ('singleDevice', 'multiDevice')),
  CHECK (backed_up IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_profile_passkeys_profile
  ON profile_passkeys(profile_id, created_at);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT,
  challenge TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK (purpose IN ('register', 'authenticate')),
  CHECK (length(handle) BETWEEN 3 AND 32)
);

CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expiry
  ON passkey_challenges(expires_at, consumed_at);
