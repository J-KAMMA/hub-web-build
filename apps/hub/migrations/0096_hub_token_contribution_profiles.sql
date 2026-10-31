PRAGMA foreign_keys = ON;

ALTER TABLE profile_wallet_links ADD COLUMN active INTEGER NOT NULL DEFAULT 1
  CHECK(active IN (0,1));
ALTER TABLE profile_wallet_links ADD COLUMN unlinked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_profile_wallet_links_contribution
  ON profile_wallet_links(profile_id, active, verified_at DESC);

