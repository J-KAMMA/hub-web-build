ALTER TABLE threads ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'active'
  CHECK (moderation_status IN ('active', 'frozen'));
ALTER TABLE threads ADD COLUMN merged_into_thread_id TEXT;
ALTER TABLE threads ADD COLUMN auto_archive_at TEXT;
ALTER TABLE thread_tracking ADD COLUMN notification_mode TEXT NOT NULL DEFAULT 'instant'
  CHECK (notification_mode IN ('instant', 'digest', 'important', 'none'));
ALTER TABLE thread_post_revisions ADD COLUMN edit_reason TEXT NOT NULL DEFAULT '' CHECK (length(edit_reason) <= 300);

CREATE TABLE IF NOT EXISTS thread_operation_audit (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('move', 'freeze', 'unfreeze', 'merge', 'archive')),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 1000),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_operation_audit_thread ON thread_operation_audit(thread_id, created_at DESC);
