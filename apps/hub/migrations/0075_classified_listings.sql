PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS classified_listings (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('real-estate', 'vehicles')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  region TEXT NOT NULL,
  locality TEXT NOT NULL DEFAULT '',
  price_amount INTEGER,
  price_label TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published', 'paused', 'rejected')),
  business_verified INTEGER NOT NULL DEFAULT 0 CHECK (business_verified IN (0, 1)),
  plan_code TEXT NOT NULL DEFAULT 'free',
  featured_until TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_public_search ON classified_listings(kind, status, region, category, price_amount, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_classified_owner ON classified_listings(owner_profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_classified_review_queue ON classified_listings(status, updated_at);

CREATE TABLE IF NOT EXISTS classified_media (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE CASCADE,
  uploader_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'document')),
  mime_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  quarantine_key TEXT NOT NULL,
  asset_key TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_media_listing ON classified_media(listing_id, position, created_at);

CREATE TABLE IF NOT EXISTS classified_status_events (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE CASCADE,
  actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classified_favorites (
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (listing_id, profile_id)
);

CREATE TABLE IF NOT EXISTS classified_inquiries (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE CASCADE,
  sender_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_inquiries_listing ON classified_inquiries(listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS classified_appointments (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE CASCADE,
  requester_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  appointment_type TEXT NOT NULL CHECK (appointment_type IN ('viewing', 'test-drive')),
  requested_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'declined', 'cancelled')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_appointments_listing ON classified_appointments(listing_id, requested_at);

CREATE TABLE IF NOT EXISTS classified_reviews (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at TEXT NOT NULL,
  UNIQUE (listing_id, author_profile_id)
);

CREATE TABLE IF NOT EXISTS classified_reports (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE CASCADE,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  UNIQUE (listing_id, reporter_profile_id)
);

CREATE TABLE IF NOT EXISTS classified_plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_price_yen INTEGER NOT NULL,
  listing_limit INTEGER NOT NULL,
  featured_days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
INSERT OR IGNORE INTO classified_plans (code, name, monthly_price_yen, listing_limit, featured_days) VALUES
  ('free', '無料', 0, 1, 0),
  ('standard', 'スタンダード', 2980, 10, 0),
  ('pro', 'プロ', 9800, 100, 7);
