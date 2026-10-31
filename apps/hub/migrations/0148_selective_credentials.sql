-- Hub stores only a contextual fact and proof audit metadata. Identity source
-- records, legal names, addresses, KYC payloads and service identifiers are forbidden.
CREATE TABLE IF NOT EXISTS hub_selective_credential_challenges (
  challenge TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK (
    credential_type IN ('adult_verified', 'seller_verified')
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS hub_selective_credentials (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK (
    credential_type IN ('adult_verified', 'seller_verified')
  ),
  issuer TEXT NOT NULL CHECK (issuer = 'jkamma-identity'),
  proof_jti TEXT NOT NULL UNIQUE,
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status_checked_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, credential_type)
);
