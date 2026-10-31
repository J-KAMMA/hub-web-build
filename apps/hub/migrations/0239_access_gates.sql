-- Hub token gates (docs/hub-token-gates/DESIGN.md, lane A).
-- A gate is a creator-owned condition set; conditions are read server-side only.
CREATE TABLE IF NOT EXISTS access_gates (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  match TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  acquisition_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (match IN ('any', 'all')),
  CHECK (length(description) <= 280),
  CHECK (acquisition_url IS NULL OR (length(acquisition_url) <= 500 AND acquisition_url LIKE 'https://%')),
  CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_access_gates_owner
  ON access_gates(owner_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS access_gate_conditions (
  gate_id TEXT NOT NULL REFERENCES access_gates(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  contract TEXT NOT NULL,
  min_raw TEXT NOT NULL DEFAULT '0',
  token_ids TEXT NOT NULL DEFAULT '[]',
  decimals INTEGER,
  PRIMARY KEY (gate_id, ordinal),
  CHECK (ordinal >= 0 AND ordinal < 5),
  CHECK (kind IN ('erc20', 'erc721', 'erc1155')),
  CHECK (chain_id > 0),
  CHECK (length(contract) = 42 AND contract = lower(contract) AND contract LIKE '0x%'),
  CHECK (length(min_raw) BETWEEN 1 AND 78),
  CHECK (decimals IS NULL OR (decimals >= 0 AND decimals <= 255))
);
