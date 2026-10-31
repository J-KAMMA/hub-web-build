PRAGMA foreign_keys = ON;

-- Public token metadata only. Member wallet addresses and cross-service account
-- mappings must never be stored in Hub.
CREATE TABLE IF NOT EXISTS community_tokens (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL COLLATE NOCASE,
  network TEXT NOT NULL COLLATE NOCASE,
  contract_address TEXT,
  created_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (community_id, symbol, network),
  CHECK (length(name) BETWEEN 1 AND 80),
  CHECK (length(symbol) BETWEEN 1 AND 16),
  CHECK (length(network) BETWEEN 1 AND 40),
  CHECK (contract_address IS NULL OR length(contract_address) <= 128)
);
CREATE INDEX IF NOT EXISTS idx_community_tokens_community
  ON community_tokens(community_id, created_at);
