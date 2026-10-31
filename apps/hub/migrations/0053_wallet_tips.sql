PRAGMA foreign_keys = ON;

ALTER TABLE profile_wallet_links ADD COLUMN tips_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (tips_enabled IN (0, 1));

CREATE TABLE IF NOT EXISTS wallet_tip_transactions (
  id TEXT PRIMARY KEY,
  tx_hash TEXT NOT NULL COLLATE NOCASE UNIQUE,
  chain_id INTEGER NOT NULL,
  network TEXT NOT NULL,
  asset_symbol TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  sender_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  recipient_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  recipient_wallet_link_id TEXT REFERENCES profile_wallet_links(id) ON DELETE SET NULL,
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (chain_id > 0),
  CHECK (length(tx_hash) = 66),
  CHECK (length(network) BETWEEN 1 AND 80),
  CHECK (length(asset_symbol) BETWEEN 1 AND 16),
  CHECK (amount_wei GLOB '[0-9]*' AND length(amount_wei) BETWEEN 1 AND 100),
  CHECK (sender_profile_id <> recipient_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_wallet_tips_recipient_confirmed
  ON wallet_tip_transactions(recipient_profile_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tips_sender_confirmed
  ON wallet_tip_transactions(sender_profile_id, confirmed_at DESC);
