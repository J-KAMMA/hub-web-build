CREATE TABLE IF NOT EXISTS market_ticket_token_issuances (
  reservation_id TEXT PRIMARY KEY REFERENCES market_ticket_reservations(id),
  chain_id INTEGER NOT NULL CHECK (chain_id > 0),
  contract_address TEXT NOT NULL,
  token_id TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  token_standard TEXT NOT NULL DEFAULT 'GOHOTOKEN_NON_TRANSFERABLE'
    CHECK (token_standard = 'GOHOTOKEN_NON_TRANSFERABLE'),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','revoked')),
  issued_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (chain_id, contract_address, token_id),
  UNIQUE (chain_id, transaction_hash)
);

CREATE INDEX IF NOT EXISTS idx_market_ticket_token_issuances_status
  ON market_ticket_token_issuances(status, issued_at DESC);
