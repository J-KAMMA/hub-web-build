CREATE TABLE IF NOT EXISTS hub_trust_requests (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  context TEXT NOT NULL CHECK (
    context IN ('publishing', 'commerce', 'work', 'community', 'monetization')
  ),
  source_service TEXT NOT NULL CHECK (
    source_service IN ('hub', 'commerce', 'vault', 'music', 'listings')
  ),
  evidence_label TEXT NOT NULL CHECK (
    length(evidence_label) BETWEEN 1 AND 80
  ),
  request_type TEXT NOT NULL CHECK (
    request_type IN ('dispute', 'correction', 'revocation')
  ),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 20 AND 2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'in_review', 'accepted', 'rejected', 'cancelled')
  ),
  resolution_note TEXT NOT NULL DEFAULT '' CHECK (
    length(resolution_note) <= 1000
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_trust_requests_active
  ON hub_trust_requests(
    profile_id,
    context,
    source_service,
    evidence_label,
    request_type
  )
  WHERE status IN ('pending', 'in_review');

CREATE INDEX IF NOT EXISTS idx_hub_trust_requests_profile
  ON hub_trust_requests(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hub_trust_request_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES hub_trust_requests(id) ON DELETE CASCADE,
  actor_scope TEXT NOT NULL CHECK (
    actor_scope IN ('requester', 'reviewer', 'system')
  ),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('submitted', 'review_started', 'accepted', 'rejected', 'cancelled')
  ),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_trust_request_events_request
  ON hub_trust_request_events(request_id, created_at);
