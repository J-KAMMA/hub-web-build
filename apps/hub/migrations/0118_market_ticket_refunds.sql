CREATE TABLE IF NOT EXISTS market_ticket_refund_requests (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE REFERENCES market_ticket_reservations(id),
  buyer_profile_id TEXT NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN (
      'requested',
      'burn_pending',
      'burn_confirmed',
      'refund_pending',
      'refunded',
      'rejected',
      'failed'
    )),
  burn_transaction_hash TEXT,
  refund_reference TEXT,
  requested_at TEXT NOT NULL,
  burn_confirmed_at TEXT,
  refunded_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_ticket_refunds_status
  ON market_ticket_refund_requests(status, requested_at);
