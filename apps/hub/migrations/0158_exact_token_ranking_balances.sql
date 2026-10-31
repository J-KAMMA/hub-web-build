PRAGMA foreign_keys = ON;

-- SQLite REAL and JavaScript number cannot preserve arbitrary uint256 token
-- balances. Keep the canonical base-unit integer and token decimals instead.
ALTER TABLE token_balance_snapshots ADD COLUMN raw_amount TEXT
  CHECK (raw_amount IS NULL OR (
    length(raw_amount) BETWEEN 1 AND 78
    AND raw_amount NOT GLOB '*[^0-9]*'
    AND (raw_amount = '0' OR substr(raw_amount, 1, 1) != '0')
  ));
ALTER TABLE token_balance_snapshots ADD COLUMN token_decimals INTEGER
  CHECK (token_decimals IS NULL OR token_decimals BETWEEN 0 AND 255);

CREATE INDEX IF NOT EXISTS idx_token_balance_snapshots_exact_ranking
  ON token_balance_snapshots(ranking_id, raw_amount);

UPDATE token_rankings SET holder_count = 0;
