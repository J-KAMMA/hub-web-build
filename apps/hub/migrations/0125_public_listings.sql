CREATE TABLE IF NOT EXISTS public_listings (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('travel', 'local-services', 'classes', 'events')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  provider_label TEXT NOT NULL,
  provider_url TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  locality TEXT NOT NULL DEFAULT '',
  price_label TEXT,
  trust_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (trust_status IN ('verified', 'pending', 'not_available')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('draft', 'pending', 'published', 'paused', 'rejected')),
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_listings_public
  ON public_listings(kind, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_listings_owner
  ON public_listings(owner_profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public_listing_audit_events (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES public_listings(id) ON DELETE CASCADE,
  actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_listing_audit
  ON public_listing_audit_events(listing_id, created_at DESC);
