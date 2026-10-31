-- Bounded public Fediverse discovery registry. It stores only public network
-- endpoints and health metadata; no credentials, private activities, or user
-- account subjects are accepted here.
CREATE TABLE IF NOT EXISTS activitypub_nodes (
  host TEXT PRIMARY KEY,
  discovery_target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered',
  source_type TEXT NOT NULL DEFAULT 'federation',
  discovered_from TEXT,
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT,
  next_check_at TEXT NOT NULL,
  last_success_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  CHECK (status IN ('discovered','verified','fetching','limited','excluded')),
  CHECK (source_type IN ('seed','federation','operator')),
  CHECK (length(host) BETWEEN 3 AND 253),
  CHECK (length(discovery_target) BETWEEN 8 AND 512),
  CHECK (failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_activitypub_nodes_due
  ON activitypub_nodes(status, next_check_at, failure_count);

CREATE INDEX IF NOT EXISTS idx_activitypub_nodes_success
  ON activitypub_nodes(last_success_at DESC);
