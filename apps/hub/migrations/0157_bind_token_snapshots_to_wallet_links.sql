PRAGMA foreign_keys = ON;

-- Existing snapshots remain private until the owner refreshes them through a
-- newly verified wallet challenge. Guessing a historical wallet link would
-- risk publishing a balance from an unrelated private address.
ALTER TABLE token_balance_snapshots
  ADD COLUMN wallet_link_id TEXT REFERENCES profile_wallet_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_token_balance_snapshots_wallet_link
  ON token_balance_snapshots(wallet_link_id, ranking_id);

-- All pre-migration snapshots are intentionally unbound and therefore no
-- longer public. Avoid retaining a stale aggregate until the next refresh.
UPDATE token_rankings SET holder_count = 0;
