PRAGMA foreign_keys = ON;

-- Structured vehicle fields deliberately live beside attributes_json: older listings and
-- real-estate listings retain their existing JSON contract.
ALTER TABLE classified_listings ADD COLUMN vehicle_manufacturer TEXT;
ALTER TABLE classified_listings ADD COLUMN vehicle_model TEXT;
ALTER TABLE classified_listings ADD COLUMN vehicle_condition TEXT;
ALTER TABLE classified_listings ADD COLUMN vehicle_year INTEGER;
ALTER TABLE classified_listings ADD COLUMN vehicle_mileage INTEGER;
ALTER TABLE classified_listings ADD COLUMN vehicle_inspection_until TEXT;
ALTER TABLE classified_listings ADD COLUMN vehicle_fuel TEXT;
ALTER TABLE classified_listings ADD COLUMN vehicle_transmission TEXT;
ALTER TABLE classified_listings ADD COLUMN vehicle_drivetrain TEXT;
ALTER TABLE classified_listings ADD COLUMN vehicle_seller_type TEXT;
ALTER TABLE classified_listings ADD COLUMN registration_verified INTEGER NOT NULL DEFAULT 0 CHECK (registration_verified IN (0, 1));
ALTER TABLE classified_listings ADD COLUMN ownership_verified INTEGER NOT NULL DEFAULT 0 CHECK (ownership_verified IN (0, 1));
CREATE INDEX IF NOT EXISTS idx_classified_vehicle_search ON classified_listings(kind, status, vehicle_manufacturer, vehicle_model, vehicle_year, vehicle_mileage);

ALTER TABLE classified_inquiries ADD COLUMN reply_message TEXT;
ALTER TABLE classified_inquiries ADD COLUMN replied_at TEXT;
ALTER TABLE classified_inquiries ADD COLUMN replied_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE classified_appointments ADD COLUMN response_note TEXT NOT NULL DEFAULT '';
ALTER TABLE classified_appointments ADD COLUMN rescheduled_at TEXT;
ALTER TABLE classified_media ADD COLUMN purpose TEXT NOT NULL DEFAULT 'public_photo' CHECK (purpose IN ('public_photo', 'verification_document'));
UPDATE classified_media SET purpose = 'verification_document' WHERE media_type = 'document';

CREATE TABLE IF NOT EXISTS classified_saved_searches (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('real-estate', 'vehicles')), name TEXT NOT NULL,
  filters_json TEXT NOT NULL, notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1)),
  last_notified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_saved_searches_profile ON classified_saved_searches(profile_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS classified_completed_transactions (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE CASCADE,
  buyer_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, seller_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL, UNIQUE(listing_id, buyer_profile_id)
);
CREATE TABLE IF NOT EXISTS classified_audit_events (
  id TEXT PRIMARY KEY, listing_id TEXT REFERENCES classified_listings(id) ON DELETE CASCADE,
  actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL, event_type TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_audit_listing ON classified_audit_events(listing_id, created_at DESC);
