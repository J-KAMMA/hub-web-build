-- An advertiser creative creation is complete only when its first version,
-- clean asset boundary, advertiser audit, and replayable response all agree.
CREATE TRIGGER IF NOT EXISTS hub_ad_advertiser_creative_atomic_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope GLOB 'advertiser.creative.create.atomic:v1:*'
  AND OLD.state='processing'
  AND NEW.state='completed'
  AND (
    NEW.response_status <> 201
    OR NEW.response_json IS NULL
    OR json_type(NEW.response_json,'$.creativeId') <> 'text'
    OR json_type(NEW.response_json,'$.versionId') <> 'text'
    OR json_extract(NEW.response_json,'$.version') <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM hub_ad_creatives cr
      JOIN hub_ad_creative_versions cv
        ON cv.creative_id=cr.id AND cv.version=cr.current_version
      WHERE cr.id=json_extract(NEW.response_json,'$.creativeId')
        AND cv.id=json_extract(NEW.response_json,'$.versionId')
        AND cr.advertiser_ref=substr(NEW.scope,length('advertiser.creative.create.atomic:v1:')+1)
        AND cr.status='pending_review'
        AND cr.current_version=1
        AND cv.review_status='pending'
        AND (
          (cr.format<>'static_display' AND cv.image_asset_path IS NULL)
          OR (cr.format='static_display' AND EXISTS (
            SELECT 1 FROM hub_ad_image_assets ia
            WHERE cv.image_asset_path='/api/ads/assets/' || ia.id
              AND ia.advertiser_ref=cr.advertiser_ref
              AND ia.status='clean'
              AND ia.structural_result='passed'
              AND ia.scanner_result='clean'
          ))
        )
    )
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_audit_logs a
      WHERE a.actor_key='advertiser:' || substr(NEW.scope,length('advertiser.creative.create.atomic:v1:')+1)
        AND a.action='creative.created'
        AND a.target_type='creative'
        AND a.target_id=json_extract(NEW.response_json,'$.creativeId')
    )
  )
BEGIN
  SELECT RAISE(ABORT,'hub_ad_advertiser_creative_atomic_graph_incomplete');
END;
