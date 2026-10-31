PRAGMA foreign_keys = ON;

ALTER TABLE classified_listings ADD COLUMN expires_at TEXT;
ALTER TABLE classified_listings ADD COLUMN closed_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE classified_listings ADD COLUMN quality_score INTEGER NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100);
ALTER TABLE classified_media ADD COLUMN media_role TEXT NOT NULL DEFAULT 'photo' CHECK (media_role IN ('photo', 'floor-plan', 'document'));
ALTER TABLE classified_appointments ADD COLUMN alternate_dates_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE classified_appointments ADD COLUMN viewing_mode TEXT NOT NULL DEFAULT 'onsite' CHECK (viewing_mode IN ('onsite', 'online'));
ALTER TABLE classified_appointments ADD COLUMN responded_at TEXT;

CREATE TABLE IF NOT EXISTS classified_conversations (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES classified_listings(id) ON DELETE CASCADE,
  buyer_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  buyer_last_read_at TEXT,
  seller_last_read_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (listing_id, buyer_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_classified_conversation_party ON classified_conversations(seller_profile_id, buyer_profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS classified_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES classified_conversations(id) ON DELETE CASCADE,
  sender_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_messages_conversation ON classified_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS classified_saved_searches (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  notification_frequency TEXT NOT NULL DEFAULT 'off' CHECK (notification_frequency IN ('off', 'instant', 'daily', 'weekly')),
  last_notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_saved_search_profile ON classified_saved_searches(profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS classified_analytics_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  listing_id TEXT REFERENCES classified_listings(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('search', 'detail', 'favorite', 'inquiry', 'appointment')),
  day TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classified_analytics_rollup ON classified_analytics_events(day, event_type, listing_id);
