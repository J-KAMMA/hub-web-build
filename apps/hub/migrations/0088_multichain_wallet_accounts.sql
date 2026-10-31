PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile_wallet_accounts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  display_address TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK(verification_status IN ('verified','watch_only')),
  verification_method TEXT,
  verified_at TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(namespace, normalized_address),
  CHECK(length(namespace) BETWEEN 2 AND 32),
  CHECK(length(normalized_address) BETWEEN 3 AND 256)
);

CREATE TABLE IF NOT EXISTS wallet_account_networks (
  wallet_account_id TEXT NOT NULL REFERENCES profile_wallet_accounts(id) ON DELETE CASCADE,
  network_reference TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(wallet_account_id, network_reference),
  CHECK(length(network_reference) BETWEEN 1 AND 128)
);

INSERT OR IGNORE INTO profile_wallet_accounts
  (id,profile_id,namespace,normalized_address,display_address,verification_status,
   verification_method,verified_at,visibility,created_at,updated_at)
SELECT 'multichain-' || id,profile_id,'eip155',lower(wallet_address),wallet_address,
       'verified','personal_sign',verified_at,visibility,created_at,verified_at
FROM profile_wallet_links;

INSERT OR IGNORE INTO wallet_account_networks
  (wallet_account_id,network_reference,enabled,created_at)
SELECT 'multichain-' || id,CAST(chain_id AS TEXT),1,created_at
FROM profile_wallet_links;

CREATE INDEX IF NOT EXISTS idx_profile_wallet_accounts_profile
  ON profile_wallet_accounts(profile_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_account_networks_network
  ON wallet_account_networks(network_reference,wallet_account_id);
