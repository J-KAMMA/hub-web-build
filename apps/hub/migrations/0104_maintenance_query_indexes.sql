-- Bound the rows scanned by recurring maintenance jobs as these tables grow.
CREATE INDEX IF NOT EXISTS idx_work_listings_published_deadline
  ON work_listings(deadline, id)
  WHERE status = 'published' AND deadline IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_listings_closed_updated
  ON work_listings(updated_at, id)
  WHERE status != 'published';

CREATE INDEX IF NOT EXISTS idx_job_applications_pending_anonymization
  ON job_applications(listing_id, id)
  WHERE anonymized_at IS NULL;
