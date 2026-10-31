CREATE TABLE IF NOT EXISTS market_ticket_checkin_challenges (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES market_ticket_events(id),
  organizer_profile_id TEXT NOT NULL REFERENCES profiles(id),
  nonce_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_ticket_checkins (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES market_ticket_events(id),
  reservation_id TEXT NOT NULL UNIQUE REFERENCES market_ticket_reservations(id),
  token_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL UNIQUE REFERENCES market_ticket_checkin_challenges(id),
  checked_in_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_ticket_checkin_challenges_event
  ON market_ticket_checkin_challenges(event_id, expires_at);
