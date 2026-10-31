ALTER TABLE public_listings ADD COLUMN event_starts_at TEXT;
ALTER TABLE public_listings ADD COLUMN event_organizer_name TEXT;

CREATE INDEX IF NOT EXISTS idx_public_event_schedule
  ON public_listings(kind, event_starts_at)
  WHERE kind = 'events' AND event_starts_at IS NOT NULL;
