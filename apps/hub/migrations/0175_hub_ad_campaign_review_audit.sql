-- Make campaign review a single, auditable state transition. Delivery status
-- may still change independently after approval, but review metadata cannot.
ALTER TABLE hub_ad_campaigns ADD COLUMN review_reason TEXT;
ALTER TABLE hub_ad_campaigns ADD COLUMN review_audit_id TEXT;
ALTER TABLE hub_ad_campaigns ADD COLUMN reviewed_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_campaigns_review_audit
  ON hub_ad_campaigns(review_audit_id)
  WHERE review_audit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_review_transition_allowed
BEFORE UPDATE OF review_status ON hub_ad_campaigns
WHEN NOT (
  (OLD.review_status IN ('pending', 'escalated') AND NEW.review_status IN ('approved', 'needs_changes', 'rejected'))
  OR (OLD.review_status = 'needs_changes' AND NEW.review_status IN ('approved', 'rejected'))
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_campaign_review_transition_invalid');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_review_requires_audit
BEFORE UPDATE OF review_status ON hub_ad_campaigns
WHEN (
  NEW.review_audit_id IS NULL
  OR NEW.review_reason IS NULL
  OR length(trim(NEW.review_reason)) NOT BETWEEN 5 AND 1000
  OR NEW.reviewed_at IS NULL
  OR NEW.updated_at <> NEW.reviewed_at
  OR NEW.status <> CASE NEW.review_status
    WHEN 'approved' THEN 'approved'
    WHEN 'needs_changes' THEN 'needs_changes'
    WHEN 'rejected' THEN 'rejected'
    ELSE NEW.status
  END
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_campaign_review_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_review_fields_require_transition
BEFORE UPDATE OF review_reason, review_audit_id, reviewed_at ON hub_ad_campaigns
WHEN NEW.review_status = OLD.review_status AND (
  NEW.review_reason IS NOT OLD.review_reason
  OR NEW.review_audit_id IS NOT OLD.review_audit_id
  OR NEW.reviewed_at IS NOT OLD.reviewed_at
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_campaign_review_fields_require_transition');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_review_audit
AFTER UPDATE OF review_status ON hub_ad_campaigns
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.review_audit_id,
    'moderation-admin',
    'campaign.reviewed',
    'campaign',
    NEW.id,
    json_object('status', OLD.status, 'reviewStatus', OLD.review_status),
    json_object('decision', NEW.review_status, 'status', NEW.status, 'reason', NEW.review_reason),
    NEW.reviewed_at
  );
END;
