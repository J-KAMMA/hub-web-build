-- Campaign resubmission is a separate advertiser-owned transition from a
-- moderation decision. It advances a monotonic version and is completed only
-- together with its audit row and idempotency receipt.
ALTER TABLE hub_ad_campaigns ADD COLUMN resubmission_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hub_ad_campaigns ADD COLUMN resubmission_audit_id TEXT;
ALTER TABLE hub_ad_campaigns ADD COLUMN resubmitted_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_campaigns_resubmission_audit
  ON hub_ad_campaigns(resubmission_audit_id)
  WHERE resubmission_audit_id IS NOT NULL;

DROP TRIGGER IF EXISTS hub_ad_campaign_review_transition_allowed;
CREATE TRIGGER hub_ad_campaign_review_transition_allowed
BEFORE UPDATE OF review_status ON hub_ad_campaigns
WHEN NOT (
  (OLD.review_status IN ('pending','escalated') AND NEW.review_status IN ('approved','needs_changes','rejected'))
  OR (OLD.review_status='needs_changes' AND NEW.review_status IN ('approved','rejected'))
  OR (OLD.review_status='needs_changes' AND OLD.status='needs_changes'
    AND NEW.review_status='pending' AND NEW.status='submitted')
)
BEGIN
  SELECT RAISE(ABORT,'hub_ad_campaign_review_transition_invalid');
END;

DROP TRIGGER IF EXISTS hub_ad_campaign_review_requires_audit;
CREATE TRIGGER hub_ad_campaign_review_requires_audit
BEFORE UPDATE OF review_status ON hub_ad_campaigns
WHEN NOT (
  (
    NEW.review_status IN ('approved','needs_changes','rejected')
    AND NEW.review_audit_id IS NOT NULL
    AND NEW.review_reason IS NOT NULL
    AND length(trim(NEW.review_reason)) BETWEEN 5 AND 1000
    AND NEW.reviewed_at IS NOT NULL
    AND NEW.updated_at=NEW.reviewed_at
    AND NEW.status=NEW.review_status
    AND NEW.resubmission_version=OLD.resubmission_version
    AND NEW.resubmission_audit_id IS OLD.resubmission_audit_id
    AND NEW.resubmitted_at IS OLD.resubmitted_at
  )
  OR (
    OLD.review_status='needs_changes' AND OLD.status='needs_changes'
    AND NEW.review_status='pending' AND NEW.status='submitted'
    AND NEW.review_reason IS NULL AND NEW.review_audit_id IS NULL AND NEW.reviewed_at IS NULL
    AND NEW.resubmission_version=OLD.resubmission_version+1
    AND NEW.resubmission_audit_id IS NOT NULL
    AND NEW.resubmitted_at IS NOT NULL
    AND NEW.updated_at=NEW.resubmitted_at
    AND EXISTS (
      SELECT 1 FROM hub_ad_admin_idempotency i
      WHERE i.scope='advertiser.campaign.resubmit.atomic:v1:' || NEW.advertiser_ref || ':' || NEW.id
        AND i.execution_token=NEW.resubmission_audit_id AND i.state='processing'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT,'hub_ad_campaign_review_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_resubmission_fields_require_transition
BEFORE UPDATE OF resubmission_version,resubmission_audit_id,resubmitted_at ON hub_ad_campaigns
WHEN NOT (
  OLD.review_status='needs_changes' AND OLD.status='needs_changes'
  AND NEW.review_status='pending' AND NEW.status='submitted'
  AND NEW.resubmission_version=OLD.resubmission_version+1
  AND NEW.resubmission_audit_id IS NOT NULL
  AND NEW.resubmitted_at IS NOT NULL
  AND NEW.updated_at=NEW.resubmitted_at
)
BEGIN
  SELECT RAISE(ABORT,'hub_ad_campaign_resubmission_fields_require_transition');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_resubmission_insert_defaults
BEFORE INSERT ON hub_ad_campaigns
WHEN NEW.resubmission_version<>0 OR NEW.resubmission_audit_id IS NOT NULL OR NEW.resubmitted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'hub_ad_campaign_resubmission_insert_invalid');
END;

DROP TRIGGER IF EXISTS hub_ad_campaign_review_audit;
CREATE TRIGGER hub_ad_campaign_review_audit
AFTER UPDATE OF review_status ON hub_ad_campaigns
WHEN NEW.review_status IN ('approved','needs_changes','rejected')
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at
  ) VALUES (
    NEW.review_audit_id,'moderation-admin','campaign.reviewed','campaign',NEW.id,
    json_object('status',OLD.status,'reviewStatus',OLD.review_status),
    json_object('decision',NEW.review_status,'status',NEW.status,'reason',NEW.review_reason),
    NEW.reviewed_at
  );
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_resubmission_audit
AFTER UPDATE OF review_status ON hub_ad_campaigns
WHEN OLD.review_status='needs_changes' AND OLD.status='needs_changes'
  AND NEW.review_status='pending' AND NEW.status='submitted'
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id,actor_key,action,target_type,target_id,before_json,after_json,occurred_at
  ) VALUES (
    NEW.resubmission_audit_id,'advertiser:' || NEW.advertiser_ref,'campaign.resubmitted','campaign',NEW.id,
    json_object('status',OLD.status,'reviewStatus',OLD.review_status,'resubmissionVersion',OLD.resubmission_version),
    json_object('status',NEW.status,'reviewStatus',NEW.review_status,'resubmissionVersion',NEW.resubmission_version),
    NEW.resubmitted_at
  );
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_resubmission_atomic_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope GLOB 'advertiser.campaign.resubmit.atomic:v1:*'
  AND OLD.state='processing'
  AND NEW.state='completed'
  AND (
    NEW.response_status<>200
    OR NEW.response_json IS NULL
    OR json_type(NEW.response_json,'$.ok')<>'true'
    OR json_type(NEW.response_json,'$.campaignId')<>'text'
    OR json_type(NEW.response_json,'$.resubmissionVersion')<>'integer'
    OR json_type(NEW.response_json,'$.auditId')<>'text'
    OR json_type(NEW.response_json,'$.submittedAt')<>'integer'
    OR json_extract(NEW.response_json,'$.auditId')<>NEW.execution_token
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_campaigns c
      JOIN hub_ad_audit_logs a ON a.id=c.resubmission_audit_id
      WHERE c.id=json_extract(NEW.response_json,'$.campaignId')
        AND NEW.scope='advertiser.campaign.resubmit.atomic:v1:' || c.advertiser_ref || ':' || c.id
        AND c.status='submitted' AND c.review_status='pending'
        AND c.review_reason IS NULL AND c.review_audit_id IS NULL AND c.reviewed_at IS NULL
        AND c.resubmission_version=json_extract(NEW.response_json,'$.resubmissionVersion')
        AND c.resubmission_audit_id=json_extract(NEW.response_json,'$.auditId')
        AND c.resubmitted_at=json_extract(NEW.response_json,'$.submittedAt')
        AND a.actor_key='advertiser:' || c.advertiser_ref
        AND a.action='campaign.resubmitted' AND a.target_type='campaign' AND a.target_id=c.id
        AND json_extract(a.before_json,'$.status')='needs_changes'
        AND json_extract(a.before_json,'$.reviewStatus')='needs_changes'
        AND json_extract(a.after_json,'$.status')='submitted'
        AND json_extract(a.after_json,'$.reviewStatus')='pending'
        AND json_extract(a.after_json,'$.resubmissionVersion')=c.resubmission_version
        AND a.occurred_at=c.resubmitted_at
    )
  )
BEGIN
  SELECT RAISE(ABORT,'hub_ad_campaign_resubmission_atomic_graph_incomplete');
END;
