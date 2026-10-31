PRAGMA foreign_keys = ON;

-- One-time ownership proof for linking a public payment wallet to a Hub profile.
-- Vault, Commerce, Identity, KYC, and payment account IDs never enter Hub.
CREATE TABLE IF NOT EXISTS wallet_account_link_challenges (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL COLLATE NOCASE,
  chain_id INTEGER NOT NULL,
  network TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  purpose TEXT NOT NULL DEFAULT 'payment_account_link'
    CHECK (purpose = 'payment_account_link'),
  CHECK (length(wallet_address) = 42),
  CHECK (chain_id > 0),
  CHECK (length(network) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_wallet_account_link_challenges_expiry
  ON wallet_account_link_challenges(expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_wallet_account_link_challenges_profile
  ON wallet_account_link_challenges(profile_id, issued_at DESC);
