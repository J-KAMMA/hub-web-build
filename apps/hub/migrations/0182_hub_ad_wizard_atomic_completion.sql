-- The advertiser wizard creates a paid-delivery graph. Its idempotency row may
-- be completed only after every required record and audit entry exists in the
-- same transaction. A missing conditional insert aborts the whole D1 batch.
CREATE TRIGGER IF NOT EXISTS hub_ad_wizard_atomic_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope GLOB 'advertiser.wizard.atomic:v1:*'
  AND OLD.state = 'processing'
  AND NEW.state = 'completed'
  AND (
    NEW.response_status <> 201
    OR NEW.response_json IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_campaigns c
      WHERE c.id = json_extract(NEW.response_json, '$.campaignId')
        AND c.advertiser_ref = substr(NEW.scope, length('advertiser.wizard.atomic:v1:') + 1)
        AND c.status = 'submitted'
        AND c.review_status = 'pending'
    )
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_line_items li
      WHERE li.id = json_extract(NEW.response_json, '$.lineItemId')
        AND li.campaign_id = json_extract(NEW.response_json, '$.campaignId')
        AND li.status = 'draft'
    )
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_creatives cr
      WHERE cr.id = json_extract(NEW.response_json, '$.creativeId')
        AND cr.advertiser_ref = substr(NEW.scope, length('advertiser.wizard.atomic:v1:') + 1)
        AND cr.status = 'pending_review'
        AND cr.current_version = 1
    )
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_creative_versions cv
      WHERE cv.id = json_extract(NEW.response_json, '$.creativeVersionId')
        AND cv.creative_id = json_extract(NEW.response_json, '$.creativeId')
        AND cv.version = 1
        AND cv.review_status = 'pending'
    )
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_line_item_creatives lic
      WHERE lic.line_item_id = json_extract(NEW.response_json, '$.lineItemId')
        AND lic.creative_version_id = json_extract(NEW.response_json, '$.creativeVersionId')
    )
    OR json_extract(NEW.response_json, '$.placementCount') IS NULL
    OR json_type(NEW.response_json, '$.placementCount') <> 'integer'
    OR json_extract(NEW.response_json, '$.placementCount') NOT BETWEEN 1 AND 20
    OR (
      SELECT COUNT(*) FROM hub_ad_line_item_placements lip
      WHERE lip.line_item_id = json_extract(NEW.response_json, '$.lineItemId')
    ) <> json_extract(NEW.response_json, '$.placementCount')
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_submission_checks sc
      WHERE sc.campaign_id = json_extract(NEW.response_json, '$.campaignId')
        AND sc.creative_version_id = json_extract(NEW.response_json, '$.creativeVersionId')
        AND sc.result = 'passed'
    )
    OR NOT EXISTS (SELECT 1 FROM hub_ad_audit_logs a WHERE a.actor_key='advertiser:' || substr(NEW.scope,length('advertiser.wizard.atomic:v1:')+1) AND a.action='campaign.created' AND a.target_type='campaign' AND a.target_id=json_extract(NEW.response_json,'$.campaignId'))
    OR NOT EXISTS (SELECT 1 FROM hub_ad_audit_logs a WHERE a.actor_key='advertiser:' || substr(NEW.scope,length('advertiser.wizard.atomic:v1:')+1) AND a.action='creative.created' AND a.target_type='creative' AND a.target_id=json_extract(NEW.response_json,'$.creativeId'))
    OR NOT EXISTS (SELECT 1 FROM hub_ad_audit_logs a WHERE a.actor_key='advertiser:' || substr(NEW.scope,length('advertiser.wizard.atomic:v1:')+1) AND a.action='line_item.created' AND a.target_type='line_item' AND a.target_id=json_extract(NEW.response_json,'$.lineItemId'))
    OR NOT EXISTS (SELECT 1 FROM hub_ad_audit_logs a WHERE a.actor_key='advertiser:' || substr(NEW.scope,length('advertiser.wizard.atomic:v1:')+1) AND a.action='creative.attached' AND a.target_type='line_item' AND a.target_id=json_extract(NEW.response_json,'$.lineItemId'))
  )
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_wizard_atomic_graph_incomplete');
END;
