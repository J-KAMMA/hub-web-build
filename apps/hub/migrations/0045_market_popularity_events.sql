PRAGMA foreign_keys = ON;

-- Privacy-preserving daily shopping engagement. The viewer hash comes from a
-- random host-only Hub cookie; no profile, IP address, or user agent is stored.
CREATE TABLE IF NOT EXISTS market_popularity_events (
  product_key TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,
  viewer_hash TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('product_view', 'comparison_click', 'favorite_add')
  ),
  event_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (product_key, viewer_hash, event_type, event_date),
  CHECK (length(viewer_hash) = 64),
  CHECK (length(event_date) = 10)
);

CREATE INDEX IF NOT EXISTS idx_market_popularity_events_recent
  ON market_popularity_events(event_date, product_key, event_type);
