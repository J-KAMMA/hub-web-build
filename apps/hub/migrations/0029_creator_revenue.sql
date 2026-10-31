PRAGMA foreign_keys = ON;

-- Hub keeps only pseudonymous creator accounting. Legal identity, KYC,
-- contact details, payout instruments, and cross-service account mappings
-- belong to a separate payout service and must never be added here.
CREATE TABLE IF NOT EXISTS creator_monetization_preferences (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  participation_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (participation_enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS creator_revenue_periods (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_report_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  gross_revenue_micros INTEGER NOT NULL,
  platform_fee_bps INTEGER NOT NULL,
  distributable_revenue_micros INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  CHECK (source IN ('adsense', 'direct_sponsor', 'affiliate', 'adjustment')),
  CHECK (currency = 'JPY'),
  CHECK (period_end > period_start),
  CHECK (gross_revenue_micros >= 0),
  CHECK (platform_fee_bps BETWEEN 0 AND 10000),
  CHECK (distributable_revenue_micros >= 0 AND distributable_revenue_micros <= gross_revenue_micros),
  CHECK (status IN ('draft', 'finalized', 'void')),
  CHECK ((status = 'finalized') = (finalized_at IS NOT NULL)),
  UNIQUE (source, source_report_id)
);
CREATE INDEX IF NOT EXISTS idx_creator_revenue_periods_status_end
  ON creator_revenue_periods(status, period_end DESC);

CREATE TABLE IF NOT EXISTS creator_revenue_allocations (
  period_id TEXT NOT NULL REFERENCES creator_revenue_periods(id) ON DELETE RESTRICT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  eligible_units INTEGER NOT NULL,
  amount_micros INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (period_id, profile_id),
  CHECK (eligible_units > 0),
  CHECK (amount_micros >= 0)
);
CREATE INDEX IF NOT EXISTS idx_creator_revenue_allocations_profile
  ON creator_revenue_allocations(profile_id, period_id);

