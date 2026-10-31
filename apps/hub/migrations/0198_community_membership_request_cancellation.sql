PRAGMA foreign_keys = ON;

ALTER TABLE community_membership_requests
  ADD COLUMN resolution_operation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_membership_request_resolution_operation
  ON community_membership_requests(resolution_operation_id)
  WHERE resolution_operation_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS community_membership_request_cancel_guard
BEFORE UPDATE OF status, resolved_at, resolved_by_profile_id, resolution_operation_id
ON community_membership_requests
WHEN NEW.status = 'cancelled' AND OLD.status != 'cancelled'
BEGIN
  SELECT RAISE(ABORT, 'membership_request_cancel_requires_pending')
  WHERE OLD.status != 'pending';
  SELECT RAISE(ABORT, 'membership_request_cancel_requires_self')
  WHERE NEW.resolved_by_profile_id IS NULL
     OR NEW.resolved_by_profile_id != OLD.profile_id;
  SELECT RAISE(ABORT, 'membership_request_cancel_requires_receipt')
  WHERE NEW.resolved_at IS NULL
     OR NEW.resolution_operation_id IS NULL
     OR length(NEW.resolution_operation_id) < 16
     OR length(NEW.resolution_operation_id) > 80;
END;

CREATE TRIGGER IF NOT EXISTS community_membership_request_resolution_operation_guard
BEFORE UPDATE OF status, resolved_at, resolved_by_profile_id, resolution_operation_id
ON community_membership_requests
WHEN OLD.resolution_operation_id IS NOT NULL
 AND NOT (
   OLD.status IN ('rejected', 'cancelled')
   AND NEW.status = 'pending'
   AND NEW.resolution_operation_id IS NULL
   AND NEW.resolved_at IS NULL
   AND NEW.resolved_by_profile_id IS NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'membership_request_resolution_operation_immutable');
END;

CREATE TRIGGER IF NOT EXISTS community_membership_request_cancel_audit
AFTER UPDATE OF status ON community_membership_requests
WHEN OLD.status = 'pending' AND NEW.status = 'cancelled'
BEGIN
  INSERT INTO community_audit_log
    (id, community_id, actor_profile_id, target_profile_id, action, detail, created_at)
  VALUES (
    NEW.resolution_operation_id,
    NEW.community_id,
    NEW.profile_id,
    NEW.profile_id,
    'membership_request_cancelled',
    json_object(
      'targetId', NEW.profile_id,
      'targetLabel', '本人の参加申請',
      'note', '参加申請を取り消しました。'
    ),
    NEW.resolved_at
  );
END;
