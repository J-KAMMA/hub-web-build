-- AI owns discovery/comparison/selection and returns a signed proposal before
-- any consequential contract or payment approval.
ALTER TABLE hub_intent_owner_result_proofs
  RENAME TO hub_intent_owner_result_proofs_legacy;

CREATE TABLE hub_intent_owner_result_proofs (
  jti TEXT PRIMARY KEY,
  intent_run_id TEXT NOT NULL REFERENCES hub_intent_runs(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  stage TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (issuer IN ('jkamma-ai','jkamma-commerce')),
  CHECK (stage IN ('discovery','fulfillment'))
);

INSERT INTO hub_intent_owner_result_proofs
  (jti, intent_run_id, issuer, stage, consumed_at, expires_at)
SELECT jti, intent_run_id, issuer, stage, consumed_at, expires_at
FROM hub_intent_owner_result_proofs_legacy
WHERE stage = 'fulfillment';

DROP TABLE hub_intent_owner_result_proofs_legacy;

CREATE INDEX idx_hub_intent_owner_proofs_expiry
  ON hub_intent_owner_result_proofs(expires_at);
