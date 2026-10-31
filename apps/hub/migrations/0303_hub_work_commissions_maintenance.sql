-- 指名依頼の通知と保存期間 (docs/hub-commissions/DESIGN.md 6.4, 12-5; owner decision 2026-10-29).
-- Files only: not applied to any D1 database from this change.
--
-- review_notified_at: set once the "review period ends within 24 hours" notice went out, so the hourly sweep
--   never repeats it and never re-reads the contract.
-- thread_purged_at: set once every thread message of a contract past the 1-year retention is gone, so the purge
--   walks only contracts it still has to clean. Neither column touches on-chain or Commerce data.
ALTER TABLE work_contracts ADD COLUMN review_notified_at TEXT;
ALTER TABLE work_contracts ADD COLUMN thread_purged_at TEXT;

CREATE INDEX IF NOT EXISTS idx_work_contracts_review_due ON work_contracts(release_at, id)
  WHERE escrow_state = 'delivered' AND review_notified_at IS NULL AND release_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_contracts_thread_purge ON work_contracts(closed_at, id)
  WHERE closed_at IS NOT NULL AND thread_purged_at IS NULL;
