ALTER TABLE public_listings ADD COLUMN cancelled_at TEXT;
ALTER TABLE public_listings ADD COLUMN cancellation_reason TEXT;
ALTER TABLE public_listings ADD COLUMN cancelled_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_public_listings_discovery
  ON public_listings(kind, status, cancelled_at, published_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_listing_cancelled_once
  ON public_listing_audit_events(listing_id)
  WHERE event_type = 'listing.cancelled';
