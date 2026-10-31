-- A moderation-admin creative attachment is complete only when it points to
-- the exact current version and has an exact audit and replayable response.
CREATE TRIGGER IF NOT EXISTS hub_ad_admin_creative_attachment_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope LIKE 'admin.creative.attach.atomic:v1:%'
  AND OLD.state='processing' AND NEW.state='completed'
  AND (
    NEW.response_status<>200 OR NEW.response_json IS NULL
    OR json_type(NEW.response_json,'$.attached') NOT IN ('true','integer')
    OR json_extract(NEW.response_json,'$.attached')<>1
    OR json_type(NEW.response_json,'$.lineItemId')<>'text'
    OR json_type(NEW.response_json,'$.creativeId')<>'text'
    OR json_type(NEW.response_json,'$.creativeVersionId')<>'text'
    OR json_type(NEW.response_json,'$.version')<>'integer'
    OR json_type(NEW.response_json,'$.auditId')<>'text'
    OR json_type(NEW.response_json,'$.attachedAt')<>'integer'
    OR json_extract(NEW.response_json,'$.lineItemId')<>
      substr(NEW.scope,length('admin.creative.attach.atomic:v1:')+1)
    OR json_extract(NEW.response_json,'$.auditId')<>NEW.execution_token
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_line_item_creatives lic
      JOIN hub_ad_line_items li ON li.id=lic.line_item_id
      JOIN hub_ad_campaigns c ON c.id=li.campaign_id
      JOIN hub_ad_creative_versions cv ON cv.id=lic.creative_version_id
      JOIN hub_ad_creatives cr ON cr.id=cv.creative_id
      WHERE li.id=json_extract(NEW.response_json,'$.lineItemId')
        AND cr.id=json_extract(NEW.response_json,'$.creativeId')
        AND cv.id=json_extract(NEW.response_json,'$.creativeVersionId')
        AND cv.version=json_extract(NEW.response_json,'$.version')
        AND cr.current_version=cv.version
        AND li.status IN ('draft','paused')
        AND c.status IN ('draft','submitted','under_review','needs_changes','approved','scheduled','paused')
        AND c.advertiser_ref=cr.advertiser_ref
        AND cr.status IN ('pending_review','approved','paused')
        AND EXISTS(SELECT 1 FROM hub_ad_line_item_placements lip WHERE lip.line_item_id=li.id)
        AND NOT EXISTS(SELECT 1 FROM hub_ad_line_item_placements lip
          JOIN hub_ad_placements p ON p.id=lip.placement_id
          WHERE lip.line_item_id=li.id AND p.format<>cr.format)
        AND (SELECT COUNT(*) FROM hub_ad_line_item_creatives all_lic
          JOIN hub_ad_creative_versions all_cv ON all_cv.id=all_lic.creative_version_id
          WHERE all_lic.line_item_id=li.id AND all_cv.creative_id=cr.id)=1
    )
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_audit_logs a
      JOIN hub_ad_creatives cr ON cr.id=json_extract(NEW.response_json,'$.creativeId')
      WHERE a.id=json_extract(NEW.response_json,'$.auditId')
        AND a.actor_key='moderation-admin'
        AND a.action='creative.attached'
        AND a.target_type='line_item'
        AND a.target_id=json_extract(NEW.response_json,'$.lineItemId')
        AND a.before_json IS NULL
        AND json_extract(a.after_json,'$.creativeId')=json_extract(NEW.response_json,'$.creativeId')
        AND json_extract(a.after_json,'$.creativeVersionId')=json_extract(NEW.response_json,'$.creativeVersionId')
        AND json_extract(a.after_json,'$.version')=json_extract(NEW.response_json,'$.version')
        AND json_extract(a.after_json,'$.advertiserRef')=cr.advertiser_ref
        AND json_extract(a.after_json,'$.format')=cr.format
        AND a.occurred_at=json_extract(NEW.response_json,'$.attachedAt')
    )
  )
BEGIN
  SELECT RAISE(ABORT,'hub_ad_admin_creative_attachment_graph_incomplete');
END;
