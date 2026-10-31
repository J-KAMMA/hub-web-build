-- Hub token gates, lane A: attach a gate to a piece of Hub content, and the
-- per-profile check cache. The cache stores a result category and expiry only:
-- never wallet addresses or balances.
CREATE TABLE IF NOT EXISTS content_access_gates (
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  gate_id TEXT NOT NULL REFERENCES access_gates(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id),
  CHECK (target_type IN ('post', 'article', 'video', 'thread', 'channel')),
  CHECK (length(target_id) BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS idx_content_access_gates_gate
  ON content_access_gates(gate_id);

CREATE TABLE IF NOT EXISTS access_gate_checks (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL REFERENCES access_gates(id) ON DELETE CASCADE,
  gate_version INTEGER NOT NULL,
  allowed INTEGER NOT NULL,
  checked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, gate_id),
  CHECK (allowed IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_access_gate_checks_expiry
  ON access_gate_checks(expires_at);
