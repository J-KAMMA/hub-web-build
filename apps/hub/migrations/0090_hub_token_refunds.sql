CREATE TABLE IF NOT EXISTS hub_token_refunds (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 64),
  external_refund_id TEXT NOT NULL CHECK(length(external_refund_id) BETWEEN 1 AND 128),
  revenue_id TEXT NOT NULL CHECK(length(revenue_id) = 66),
  normalized_hub_revenue_refunded TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed')),
  completed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source, external_refund_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_token_refunds_completed
  ON hub_token_refunds(status, completed_at);
