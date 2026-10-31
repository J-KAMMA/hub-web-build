-- A moderation-admin line item is complete only with its placement graph,
-- campaign budget boundary, exact audit, and replayable response.
CREATE TRIGGER IF NOT EXISTS hub_ad_admin_line_item_atomic_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope LIKE 'admin.line_item.create.atomic:v1:%'
  AND OLD.state='processing' AND NEW.state='completed'
  AND (
    NEW.response_status<>201 OR NEW.response_json IS NULL
    OR json_type(NEW.response_json,'$.id')<>'text'
    OR json_type(NEW.response_json,'$.campaignId')<>'text'
    OR json_type(NEW.response_json,'$.placementIds')<>'array'
    OR json_array_length(NEW.response_json,'$.placementIds')<1
    OR json_type(NEW.response_json,'$.budgetJpyMicros')<>'integer'
    OR json_type(NEW.response_json,'$.auditId')<>'text'
    OR json_type(NEW.response_json,'$.createdAt')<>'integer'
    OR json_extract(NEW.response_json,'$.campaignId')<>
      substr(NEW.scope,length('admin.line_item.create.atomic:v1:')+1)
    OR json_extract(NEW.response_json,'$.auditId')<>NEW.execution_token
    OR (SELECT COUNT(*) FROM json_each(NEW.response_json,'$.placementIds'))<>
      (SELECT COUNT(DISTINCT value) FROM json_each(NEW.response_json,'$.placementIds'))
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_line_items li JOIN hub_ad_campaigns c ON c.id=li.campaign_id
      WHERE li.id=json_extract(NEW.response_json,'$.id')
        AND li.campaign_id=json_extract(NEW.response_json,'$.campaignId')
        AND li.budget_jpy_micros=json_extract(NEW.response_json,'$.budgetJpyMicros')
        AND li.status='draft' AND li.created_at=json_extract(NEW.response_json,'$.createdAt')
        AND li.updated_at=li.created_at
        AND c.status IN ('draft','needs_changes','approved')
        AND c.pricing_model=li.pricing_model
        AND li.start_at>=c.start_at AND li.end_at<=c.end_at
        AND (SELECT COALESCE(SUM(all_li.budget_jpy_micros),0) FROM hub_ad_line_items all_li
          WHERE all_li.campaign_id=c.id AND all_li.status<>'archived')<=c.total_budget_jpy_micros
        AND (SELECT COUNT(*) FROM hub_ad_line_item_placements lip WHERE lip.line_item_id=li.id)=
          json_array_length(NEW.response_json,'$.placementIds')
        AND NOT EXISTS(SELECT 1 FROM json_each(NEW.response_json,'$.placementIds') requested
          WHERE NOT EXISTS(SELECT 1 FROM hub_ad_line_item_placements lip
            WHERE lip.line_item_id=li.id AND lip.placement_id=requested.value))
        AND (SELECT COUNT(DISTINCT p.format) FROM hub_ad_line_item_placements lip
          JOIN hub_ad_placements p ON p.id=lip.placement_id WHERE lip.line_item_id=li.id)=1
        AND NOT EXISTS(SELECT 1 FROM hub_ad_line_item_placements lip
          JOIN hub_ad_placements p ON p.id=lip.placement_id
          WHERE lip.line_item_id=li.id AND (
            p.status='archived' OR p.pricing_model<>li.pricing_model
            OR p.floor_price_jpy_micros>li.rate_jpy_micros
            OR EXISTS(SELECT 1 FROM json_each(li.targeting_rules_json) requested
              WHERE requested.key NOT IN ('estimatedAudience','estimatedMonthlyImpressions')
                AND NOT EXISTS(SELECT 1 FROM json_each(p.targeting_allowed_json) allowed
                  WHERE allowed.value=requested.key))
          ))
    )
    OR NOT EXISTS(
      SELECT 1 FROM hub_ad_audit_logs a
      WHERE a.id=json_extract(NEW.response_json,'$.auditId')
        AND a.actor_key='moderation-admin'
        AND a.action='line_item.created'
        AND a.target_type='line_item'
        AND a.target_id=json_extract(NEW.response_json,'$.id')
        AND a.before_json IS NULL
        AND json_extract(a.after_json,'$.campaignId')=json_extract(NEW.response_json,'$.campaignId')
        AND json_extract(a.after_json,'$.pricingModel')=(SELECT pricing_model FROM hub_ad_line_items
          WHERE id=json_extract(NEW.response_json,'$.id'))
        AND json_extract(a.after_json,'$.budgetJpyMicros')=json_extract(NEW.response_json,'$.budgetJpyMicros')
        AND json_extract(a.after_json,'$.status')='draft'
        AND json_extract(a.after_json,'$.placementIds')=json_extract(NEW.response_json,'$.placementIds')
        AND a.occurred_at=json_extract(NEW.response_json,'$.createdAt')
    )
  )
BEGIN
  SELECT RAISE(ABORT,'hub_ad_admin_line_item_atomic_graph_incomplete');
END;
