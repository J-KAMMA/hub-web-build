-- Traffic anomaly decisions affect advertising enforcement. Bind the final
-- decision and audit receipt atomically without copying the moderator note
-- into the general audit log.
ALTER TABLE hub_ad_traffic_reviews ADD COLUMN review_audit_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_traffic_reviews_review_audit
  ON hub_ad_traffic_reviews(review_audit_id)
  WHERE review_audit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS hub_ad_traffic_review_must_start_open
BEFORE INSERT ON hub_ad_traffic_reviews
WHEN NEW.status <> 'open'
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_traffic_review_must_start_open');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_traffic_review_transition_allowed
BEFORE UPDATE OF status ON hub_ad_traffic_reviews
WHEN OLD.status = 'open' AND NEW.status NOT IN ('reviewed', 'dismissed')
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_traffic_review_transition_invalid');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_traffic_review_requires_audit
BEFORE UPDATE OF status ON hub_ad_traffic_reviews
WHEN OLD.status = 'open' AND NEW.status IN ('reviewed', 'dismissed') AND (
  NEW.review_audit_id IS NULL
  OR NEW.review_note IS NULL
  OR length(trim(NEW.review_note)) NOT BETWEEN 5 AND 1000
  OR NEW.reviewed_at IS NULL
  OR NEW.reviewed_by_actor_key <> 'moderation-admin'
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_traffic_review_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_traffic_review_fields_require_transition
BEFORE UPDATE OF review_note, review_audit_id, reviewed_at, reviewed_by_actor_key
ON hub_ad_traffic_reviews
WHEN NOT (OLD.status = 'open' AND NEW.status IN ('reviewed', 'dismissed')) AND (
  NEW.review_note IS NOT OLD.review_note
  OR NEW.review_audit_id IS NOT OLD.review_audit_id
  OR NEW.reviewed_at IS NOT OLD.reviewed_at
  OR NEW.reviewed_by_actor_key IS NOT OLD.reviewed_by_actor_key
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_traffic_review_fields_require_transition');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_traffic_review_decision_final
BEFORE UPDATE OF status ON hub_ad_traffic_reviews
WHEN OLD.status IN ('reviewed', 'dismissed') AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_traffic_review_decision_final');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_traffic_review_audit
AFTER UPDATE OF status ON hub_ad_traffic_reviews
WHEN OLD.status = 'open' AND NEW.status IN ('reviewed', 'dismissed')
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.review_audit_id,
    'moderation-admin',
    'traffic_review.resolved',
    'traffic_review',
    NEW.id,
    json_object('status', OLD.status),
    json_object(
      'decision', NEW.status,
      'reasonCode', NEW.reason_code,
      'severity', NEW.severity
    ),
    NEW.reviewed_at
  );
END;
