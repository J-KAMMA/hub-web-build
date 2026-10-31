CREATE TABLE IF NOT EXISTS hub_admin_mfa_recovery_codes (
  code_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hub_admin_mfa_recovery_codes_unused
  ON hub_admin_mfa_recovery_codes(used_at, created_at);
