-- Durable state for x402 settlement so retries never resubmit an externally
-- confirmed payment merely because the local D1 commit was interrupted.
CREATE TABLE IF NOT EXISTS hub_ad_x402_settlement_attempts (
  deposit_id TEXT PRIMARY KEY REFERENCES hub_ad_x402_deposits(id) ON DELETE RESTRICT,
  operation_token TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved','submitted','external_confirmed','completed','unknown')),
  transaction_hash TEXT,
  locked_until INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (state IN ('reserved','submitted','unknown') AND transaction_hash IS NULL)
    OR (
      state IN ('external_confirmed','completed')
      AND substr(transaction_hash,1,2)='0x'
      AND length(transaction_hash)=66
      AND substr(transaction_hash,3) NOT GLOB '*[^0-9a-f]*'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_x402_settlement_attempt_state
  ON hub_ad_x402_settlement_attempts(state, updated_at);
