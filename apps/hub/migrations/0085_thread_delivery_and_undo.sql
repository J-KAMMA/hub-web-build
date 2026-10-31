CREATE TABLE IF NOT EXISTS thread_notification_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES thread_posts(id) ON DELETE CASCADE,
  receiver_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('instant','digest','important')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','skipped')),
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE(post_id, receiver_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_notification_events_due ON thread_notification_events(status, delivery_mode, created_at);
ALTER TABLE thread_operation_audit ADD COLUMN undo_payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE thread_operation_audit ADD COLUMN undone_at TEXT;
CREATE TABLE IF NOT EXISTS thread_drafts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  draft_type TEXT NOT NULL CHECK (draft_type IN ('thread','reply')),
  context_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 160),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id, draft_type, context_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_drafts_profile ON thread_drafts(profile_id, updated_at DESC);
