-- Moderation-admin creative creation is complete only with its first pending
-- version, clean asset boundary, exact audit, and replayable response.
CREATE TRIGGER IF NOT EXISTS hub_ad_admin_creative_atomic_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope='admin.creative.create.atomic:v1'
  AND OLD.state='processing' AND NEW.state='completed'
  AND (
    NEW.response_status<>201 OR NEW.response_json IS NULL
    OR json_type(NEW.response_json,'$.creativeId')<>'text'
    OR json_type(NEW.response_json,'$.versionId')<>'text'
    OR json_type(NEW.response_json,'$.version')<>'integer'
    OR json_extract(NEW.response_json,'$.version')<>1
    OR json_type(NEW.response_json,'$.advertiserRef')<>'text'
    OR json_type(NEW.response_json,'$.format')<>'text'
    OR json_type(NEW.response_json,'$.auditId')<>'text'
    OR json_type(NEW.response_json,'$.createdAt')<>'integer'
    OR json_extract(NEW.response_json,'$.auditId')<>NEW.execution_token
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_creatives cr
      JOIN hub_ad_creative_versions cv
        ON cv.creative_id=cr.id AND cv.version=cr.current_version
      WHERE cr.id=json_extract(NEW.response_json,'$.creativeId')
        AND cv.id=json_extract(NEW.response_json,'$.versionId')
        AND cr.advertiser_ref=json_extract(NEW.response_json,'$.advertiserRef')
        AND cr.format=json_extract(NEW.response_json,'$.format')
        AND cr.status='pending_review' AND cr.current_version=1
        AND cr.created_at=json_extract(NEW.response_json,'$.createdAt')
        AND cv.review_status='pending' AND cv.created_at=cr.created_at
        AND (
          (cr.format<>'static_display' AND cv.image_asset_path IS NULL)
          OR (cr.format='static_display' AND EXISTS(
            SELECT 1 FROM hub_ad_image_assets ia
            WHERE cv.image_asset_path='/api/ads/assets/' || ia.id
              AND ia.advertiser_ref=cr.advertiser_ref
              AND ia.status='clean' AND ia.structural_result='passed' AND ia.scanner_result='clean'
          ))
        )
    )
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_audit_logs a
      WHERE a.id=json_extract(NEW.response_json,'$.auditId')
        AND a.actor_key='moderation-admin'
        AND a.action='creative.created'
        AND a.target_type='creative'
        AND a.target_id=json_extract(NEW.response_json,'$.creativeId')
        AND a.before_json IS NULL
        AND json_extract(a.after_json,'$.versionId')=json_extract(NEW.response_json,'$.versionId')
        AND json_extract(a.after_json,'$.version')=1
        AND json_extract(a.after_json,'$.advertiserRef')=json_extract(NEW.response_json,'$.advertiserRef')
        AND json_extract(a.after_json,'$.format')=json_extract(NEW.response_json,'$.format')
        AND json_extract(a.after_json,'$.status')='pending_review'
        AND a.occurred_at=json_extract(NEW.response_json,'$.createdAt')
    )
  )
BEGIN
  SELECT RAISE(ABORT,'hub_ad_admin_creative_atomic_graph_incomplete');
END;
