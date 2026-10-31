PRAGMA foreign_keys = ON;

-- Public balances are keyed by ranking so identical symbols on different
-- networks remain separate. Address links, when explicitly approved by the
-- user, are stored separately from balances and challenges.
CREATE TABLE IF NOT EXISTS token_balance_snapshots (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ranking_id TEXT NOT NULL REFERENCES token_rankings(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, ranking_id),
  CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_token_balance_snapshots_ranking_amount
  ON token_balance_snapshots(ranking_id, amount DESC);

INSERT OR IGNORE INTO token_balance_snapshots (profile_id, ranking_id, amount, verified_at)
SELECT balances.profile_id, rankings.id, balances.amount, balances.updated_at
FROM token_balances balances
JOIN token_rankings rankings ON rankings.symbol = balances.symbol;

-- A challenge is short-lived and bound only to a Hub-local profile/ranking.
-- The address submitted during verification is not stored in this challenge.
CREATE TABLE IF NOT EXISTS token_balance_challenges (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ranking_id TEXT NOT NULL REFERENCES token_rankings(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  CHECK (chain_id > 0)
);
CREATE INDEX IF NOT EXISTS idx_token_balance_challenges_expiry
  ON token_balance_challenges(expires_at);
