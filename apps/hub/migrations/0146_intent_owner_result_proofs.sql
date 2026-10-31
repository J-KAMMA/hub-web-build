-- One-time, short-lived owner-service results for Hub Intent orchestration.
-- The proof carries no account, payment, order, wallet, prompt, or provider data.
CREATE TABLE IF NOT EXISTS hub_intent_owner_result_proofs (
  jti TEXT PRIMARY KEY,
  intent_run_id TEXT NOT NULL REFERENCES hub_intent_runs(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  stage TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (issuer IN ('jkamma-ai','jkamma-commerce')),
  CHECK (stage IN ('execution','fulfillment'))
);

CREATE INDEX IF NOT EXISTS idx_hub_intent_owner_proofs_expiry
  ON hub_intent_owner_result_proofs(expires_at);
