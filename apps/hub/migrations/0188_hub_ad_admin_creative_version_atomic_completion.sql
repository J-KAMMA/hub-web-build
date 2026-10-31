-- Moderation-admin version creation advances one exact current version and is
-- complete only with attachment replacement, audit, and a replayable receipt.
CREATE TRIGGER IF NOT EXISTS hub_ad_admin_creative_version_atomic_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope GLOB 'admin.creative.version.create.atomic:v1:*'
  AND OLD.state='processing' AND NEW.state='completed'
  AND (
    NEW.response_status<>201 OR NEW.response_json IS NULL
    OR json_type(NEW.response_json,'$.creativeId')<>'text'
    OR json_type(NEW.response_json,'$.versionId')<>'text'
    OR json_type(NEW.response_json,'$.version')<>'integer'
    OR json_type(NEW.response_json,'$.previousVersionId')<>'text'
    OR json_type(NEW.response_json,'$.previousVersion')<>'integer'
    OR json_type(NEW.response_json,'$.auditId')<>'text'
    OR json_type(NEW.response_json,'$.createdAt')<>'integer'
    OR json_extract(NEW.response_json,'$.version')<>json_extract(NEW.response_json,'$.previousVersion')+1
    OR json_extract(NEW.response_json,'$.auditId')<>NEW.execution_token
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_creatives cr
      JOIN hub_ad_creative_versions current
        ON current.creative_id=cr.id AND current.version=cr.current_version
      JOIN hub_ad_creative_versions previous
        ON previous.creative_id=cr.id
      WHERE cr.id=json_extract(NEW.response_json,'$.creativeId')
        AND NEW.scope='admin.creative.version.create.atomic:v1:' || cr.id
        AND cr.status='pending_review'
        AND current.id=json_extract(NEW.response_json,'$.versionId')
        AND current.version=json_extract(NEW.response_json,'$.version')
        AND current.review_status='pending'
        AND current.created_at=json_extract(NEW.response_json,'$.createdAt')
        AND previous.id=json_extract(NEW.response_json,'$.previousVersionId')
        AND previous.version=json_extract(NEW.response_json,'$.previousVersion')
        AND (
          (cr.format<>'static_display' AND current.image_asset_path IS NULL)
          OR (cr.format='static_display' AND EXISTS(
            SELECT 1 FROM hub_ad_image_assets ia
            WHERE current.image_asset_path='/api/ads/assets/' || ia.id
              AND ia.advertiser_ref=cr.advertiser_ref
              AND ia.status='clean' AND ia.structural_result='passed' AND ia.scanner_result='clean'
          ))
        )
    )
    OR EXISTS(
      SELECT 1 FROM hub_ad_line_item_creatives lic
      WHERE lic.creative_version_id=json_extract(NEW.response_json,'$.previousVersionId')
    )
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_audit_logs a
      WHERE a.id=json_extract(NEW.response_json,'$.auditId')
        AND a.actor_key='moderation-admin'
        AND a.action='creative.version_created'
        AND a.target_type='creative'
        AND a.target_id=json_extract(NEW.response_json,'$.creativeId')
        AND json_extract(a.before_json,'$.versionId')=json_extract(NEW.response_json,'$.previousVersionId')
        AND json_extract(a.before_json,'$.version')=json_extract(NEW.response_json,'$.previousVersion')
        AND json_extract(a.after_json,'$.versionId')=json_extract(NEW.response_json,'$.versionId')
        AND json_extract(a.after_json,'$.version')=json_extract(NEW.response_json,'$.version')
        AND json_extract(a.after_json,'$.status')='pending_review'
        AND a.occurred_at=json_extract(NEW.response_json,'$.createdAt')
    )
  )
BEGIN
  SELECT RAISE(ABORT,'hub_ad_admin_creative_version_atomic_graph_incomplete');
END;
