-- Bind every advertiser status transition to one idempotent audit operation.
-- Closed advertisers are final; active/suspended transitions remain reversible
-- only through another explicitly audited review.
ALTER TABLE hub_ad_advertisers ADD COLUMN review_reason TEXT;
ALTER TABLE hub_ad_advertisers ADD COLUMN review_audit_id TEXT;

CREATE TRIGGER IF NOT EXISTS hub_ad_advertiser_review_transition_allowed
BEFORE UPDATE OF status ON hub_ad_advertisers
WHEN OLD.status <> NEW.status AND NOT (
  (OLD.status = 'pending' AND NEW.status IN ('active', 'suspended', 'closed'))
  OR (OLD.status = 'active' AND NEW.status IN ('suspended', 'closed'))
  OR (OLD.status = 'suspended' AND NEW.status IN ('active', 'closed'))
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_advertiser_review_transition_invalid');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_advertiser_review_requires_audit
BEFORE UPDATE OF status ON hub_ad_advertisers
WHEN OLD.status <> NEW.status AND (
  NEW.review_audit_id IS NULL
  OR NEW.review_reason IS NULL
  OR length(trim(NEW.review_reason)) NOT BETWEEN 5 AND 1000
  OR NEW.reviewed_at IS NULL
  OR NEW.updated_at <> NEW.reviewed_at
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_advertiser_review_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_advertiser_review_fields_require_transition
BEFORE UPDATE OF review_reason, review_audit_id, reviewed_at ON hub_ad_advertisers
WHEN OLD.status = NEW.status AND (
  NEW.review_reason IS NOT OLD.review_reason
  OR NEW.review_audit_id IS NOT OLD.review_audit_id
  OR NEW.reviewed_at IS NOT OLD.reviewed_at
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_advertiser_review_fields_require_transition');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_advertiser_review_audit
AFTER UPDATE OF status ON hub_ad_advertisers
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.review_audit_id,
    'moderation-admin',
    'advertiser.reviewed',
    'advertiser',
    NEW.advertiser_ref,
    json_object('status', OLD.status),
    json_object('decision', NEW.status, 'reason', NEW.review_reason),
    NEW.reviewed_at
  );
END;
