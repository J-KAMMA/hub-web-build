-- Server-verified, non-custodial wallet activity. Addresses are deliberately omitted.
CREATE TABLE IF NOT EXISTS wallet_activity (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tx_hash TEXT NOT NULL UNIQUE,
  chain_id INTEGER NOT NULL,
  network TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('transfer', 'contract')),
  asset_symbol TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_activity_profile_confirmed
  ON wallet_activity(profile_id, confirmed_at DESC);
