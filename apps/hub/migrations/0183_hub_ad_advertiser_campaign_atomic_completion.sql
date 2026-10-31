-- An advertiser campaign creation is complete only when the campaign, its
-- advertiser-scoped audit receipt, and the replayable 201 response coexist.
CREATE TRIGGER IF NOT EXISTS hub_ad_advertiser_campaign_atomic_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope GLOB 'advertiser.campaign.create.atomic:v1:*'
  AND OLD.state='processing'
  AND NEW.state='completed'
  AND (
    NEW.response_status <> 201
    OR NEW.response_json IS NULL
    OR json_type(NEW.response_json,'$.id') <> 'text'
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_campaigns c
      WHERE c.id=json_extract(NEW.response_json,'$.id')
        AND c.advertiser_ref=substr(NEW.scope,length('advertiser.campaign.create.atomic:v1:')+1)
        AND c.created_by_actor_key='advertiser:' || c.advertiser_ref
        AND c.status='draft'
        AND c.review_status='pending'
    )
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_audit_logs a
      WHERE a.actor_key='advertiser:' || substr(NEW.scope,length('advertiser.campaign.create.atomic:v1:')+1)
        AND a.action='campaign.created'
        AND a.target_type='campaign'
        AND a.target_id=json_extract(NEW.response_json,'$.id')
    )
  )
BEGIN
  SELECT RAISE(ABORT,'hub_ad_advertiser_campaign_atomic_graph_incomplete');
END;
