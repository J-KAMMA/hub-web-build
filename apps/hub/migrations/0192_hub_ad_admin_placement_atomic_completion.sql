-- A moderation-admin placement is complete only with its exact configuration,
-- audit, and replayable 201 response.
CREATE TRIGGER IF NOT EXISTS hub_ad_admin_placement_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope='admin.placement.create.atomic:v1'
  AND OLD.state='processing' AND NEW.state='completed'
  AND (
    NEW.response_status<>201 OR NEW.response_json IS NULL
    OR json_type(NEW.response_json,'$.id')<>'text'
    OR json_type(NEW.response_json,'$.created') NOT IN ('true','integer')
    OR json_extract(NEW.response_json,'$.created')<>1
    OR json_type(NEW.response_json,'$.placementKey')<>'text'
    OR json_type(NEW.response_json,'$.auditId')<>'text'
    OR json_type(NEW.response_json,'$.createdAt')<>'integer'
    OR json_extract(NEW.response_json,'$.auditId')<>NEW.execution_token
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_placements p
      WHERE p.id=json_extract(NEW.response_json,'$.id')
        AND p.placement_key=json_extract(NEW.response_json,'$.placementKey')
        AND p.owner_type='hub' AND p.owner_id IS NULL
        AND p.refresh_allowed=0 AND p.status='draft'
        AND p.created_at=json_extract(NEW.response_json,'$.createdAt')
        AND p.updated_at=p.created_at
    )
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_audit_logs a JOIN hub_ad_placements p
        ON p.id=json_extract(NEW.response_json,'$.id')
      WHERE a.id=json_extract(NEW.response_json,'$.auditId')
        AND a.actor_key='moderation-admin'
        AND a.action='placement.created'
        AND a.target_type='placement'
        AND a.target_id=p.id
        AND a.before_json IS NULL
        AND json_extract(a.after_json,'$.placementKey')=p.placement_key
        AND json_extract(a.after_json,'$.displayName')=p.display_name
        AND json_extract(a.after_json,'$.surfaceType')=p.surface_type
        AND json_extract(a.after_json,'$.format')=p.format
        AND json_extract(a.after_json,'$.pageCategory')=p.page_category
        AND json_extract(a.after_json,'$.pricingModel')=p.pricing_model
        AND json_extract(a.after_json,'$.floorPriceJpyMicros')=p.floor_price_jpy_micros
        AND json_extract(a.after_json,'$.maximumAdsPerPage')=p.maximum_ads_per_page
        AND json_extract(a.after_json,'$.allowedDimensions')=json(p.allowed_dimensions_json)
        AND json_extract(a.after_json,'$.targetingAllowed')=json(p.targeting_allowed_json)
        AND a.occurred_at=p.created_at
    )
  )
BEGIN
  SELECT RAISE(ABORT,'hub_ad_admin_placement_atomic_graph_incomplete');
END;
