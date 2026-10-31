PRAGMA foreign_keys = ON;

-- A link exists only after the authenticated Hub user signs a short-lived
-- challenge with the address. It is Hub-local, private by default, and can be
-- removed without deleting the profile or historical public balance snapshot.
CREATE TABLE IF NOT EXISTS profile_wallet_links (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  network TEXT NOT NULL,
  wallet_address TEXT NOT NULL COLLATE NOCASE,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public')),
  verified_at TEXT NOT NULL,
  last_balance_refresh_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (chain_id, wallet_address),
  CHECK (chain_id > 0),
  CHECK (length(network) BETWEEN 1 AND 80),
  CHECK (length(wallet_address) = 42)
);
CREATE INDEX IF NOT EXISTS idx_profile_wallet_links_profile
  ON profile_wallet_links(profile_id, verified_at DESC);
