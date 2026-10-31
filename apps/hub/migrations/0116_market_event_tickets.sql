CREATE TABLE IF NOT EXISTS market_ticket_events (
  id TEXT PRIMARY KEY,
  organizer_profile_id TEXT NOT NULL REFERENCES profiles(id),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  venue_name TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  sale_starts_at TEXT NOT NULL,
  sale_ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','cancelled','ended')),
  max_per_order INTEGER NOT NULL DEFAULT 4 CHECK (max_per_order BETWEEN 1 AND 20),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_ticket_types (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES market_ticket_events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'JPY',
  total_quantity INTEGER NOT NULL CHECK (total_quantity > 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','paused','sold_out')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_ticket_reservations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES market_ticket_events(id),
  ticket_type_id TEXT NOT NULL REFERENCES market_ticket_types(id),
  buyer_profile_id TEXT NOT NULL REFERENCES profiles(id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','pending_payment','issued','cancelled','expired','refunded')),
  hold_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_ticket_events_public
  ON market_ticket_events(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_market_ticket_types_event
  ON market_ticket_types(event_id, status);
CREATE INDEX IF NOT EXISTS idx_market_ticket_reservations_buyer
  ON market_ticket_reservations(buyer_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_ticket_reservations_expiry
  ON market_ticket_reservations(status, hold_expires_at);

