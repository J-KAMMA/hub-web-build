-- Make appeal resolution and its moderation audit one atomic database action.
-- Existing resolved rows remain readable; new resolutions must carry a unique
-- operation/audit id so retries can be replayed without a second decision.
ALTER TABLE hub_ad_review_appeals ADD COLUMN resolution_audit_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_appeals_resolution_audit
  ON hub_ad_review_appeals(resolution_audit_id)
  WHERE resolution_audit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS hub_ad_appeal_resolution_requires_audit
BEFORE UPDATE OF status ON hub_ad_review_appeals
WHEN OLD.status = 'open' AND NEW.status IN ('accepted', 'rejected') AND (
  NEW.resolution_audit_id IS NULL
  OR NEW.resolution_note IS NULL
  OR length(trim(NEW.resolution_note)) NOT BETWEEN 5 AND 1000
  OR NEW.resolved_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_appeal_resolution_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_appeal_resolution_is_final
BEFORE UPDATE OF status ON hub_ad_review_appeals
WHEN OLD.status IN ('accepted', 'rejected') AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_appeal_resolution_is_final');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_appeal_resolution_fields_are_final
BEFORE UPDATE OF resolution_note, resolved_at, resolution_audit_id ON hub_ad_review_appeals
WHEN OLD.status IN ('accepted', 'rejected') AND (
  NEW.resolution_note IS NOT OLD.resolution_note
  OR NEW.resolved_at IS NOT OLD.resolved_at
  OR NEW.resolution_audit_id IS NOT OLD.resolution_audit_id
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_appeal_resolution_fields_are_final');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_appeal_resolution_audit
AFTER UPDATE OF status ON hub_ad_review_appeals
WHEN OLD.status = 'open' AND NEW.status IN ('accepted', 'rejected')
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.resolution_audit_id,
    'moderation-admin',
    'appeal.' || NEW.status,
    'ad_review_appeal',
    NEW.id,
    json_object('status', OLD.status),
    json_object('status', NEW.status, 'targetType', NEW.target_type, 'targetId', NEW.target_id),
    NEW.resolved_at
  );
END;
