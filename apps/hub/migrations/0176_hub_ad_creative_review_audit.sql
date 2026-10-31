-- Review only the current creative version and atomically reflect the result
-- on its parent creative. A changed creative must be submitted as a new version.
ALTER TABLE hub_ad_creative_versions ADD COLUMN review_reason TEXT;
ALTER TABLE hub_ad_creative_versions ADD COLUMN review_audit_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_creative_versions_review_audit
  ON hub_ad_creative_versions(review_audit_id)
  WHERE review_audit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS hub_ad_creative_review_transition_allowed
BEFORE UPDATE OF review_status ON hub_ad_creative_versions
WHEN NOT (
  OLD.review_status IN ('pending', 'escalated')
  AND NEW.review_status IN ('approved', 'needs_changes', 'rejected')
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_creative_review_transition_invalid');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_creative_review_requires_audit
BEFORE UPDATE OF review_status ON hub_ad_creative_versions
WHEN (
  NEW.review_audit_id IS NULL
  OR NEW.review_reason IS NULL
  OR length(trim(NEW.review_reason)) NOT BETWEEN 5 AND 1000
  OR NEW.reviewed_by_actor_key <> 'moderation-admin'
  OR NEW.reviewed_at IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM hub_ad_creatives creative
    WHERE creative.id = NEW.creative_id
      AND creative.current_version = NEW.version
      AND creative.status = 'pending_review'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_creative_review_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_creative_review_fields_require_transition
BEFORE UPDATE OF review_reason, review_audit_id, reviewed_by_actor_key, reviewed_at
ON hub_ad_creative_versions
WHEN NEW.review_status = OLD.review_status AND (
  NEW.review_reason IS NOT OLD.review_reason
  OR NEW.review_audit_id IS NOT OLD.review_audit_id
  OR NEW.reviewed_by_actor_key IS NOT OLD.reviewed_by_actor_key
  OR NEW.reviewed_at IS NOT OLD.reviewed_at
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_creative_review_fields_require_transition');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_creative_parent_decision_requires_review
BEFORE UPDATE OF status ON hub_ad_creatives
WHEN NEW.status IN ('approved', 'rejected') AND NEW.status <> OLD.status AND NOT EXISTS (
  SELECT 1 FROM hub_ad_creative_versions version
  WHERE version.creative_id = NEW.id
    AND version.version = NEW.current_version
    AND version.review_status = NEW.status
    AND version.review_audit_id IS NOT NULL
    AND version.reviewed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_creative_parent_decision_requires_review');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_creative_review_audit
AFTER UPDATE OF review_status ON hub_ad_creative_versions
BEGIN
  UPDATE hub_ad_creatives
  SET status = CASE NEW.review_status
      WHEN 'approved' THEN 'approved'
      WHEN 'rejected' THEN 'rejected'
      ELSE 'pending_review'
    END,
    updated_at = NEW.reviewed_at
  WHERE id = NEW.creative_id
    AND current_version = NEW.version
    AND status = 'pending_review';

  SELECT RAISE(ABORT, 'hub_ad_creative_current_version_changed') WHERE changes() <> 1;

  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.review_audit_id,
    'moderation-admin',
    'creative.reviewed',
    'creative',
    NEW.creative_id,
    json_object(
      'reviewStatus', OLD.review_status,
      'version', OLD.version,
      'versionId', OLD.id
    ),
    json_object(
      'decision', NEW.review_status,
      'reason', NEW.review_reason,
      'version', NEW.version,
      'versionId', NEW.id,
      'creativeStatus', CASE NEW.review_status
        WHEN 'approved' THEN 'approved'
        WHEN 'rejected' THEN 'rejected'
        ELSE 'pending_review'
      END
    ),
    NEW.reviewed_at
  );
END;
