-- A sponsor reservation is consequential inventory allocation. Completion of
-- its idempotency record is valid only when reservation and advertiser audit
-- form the same owner-bound graph and all final budget/inventory gates hold.
CREATE TRIGGER IF NOT EXISTS hub_ad_sponsor_reservation_creation_atomic_completion_requires_graph
BEFORE UPDATE OF state ON hub_ad_admin_idempotency
WHEN NEW.scope GLOB 'advertiser.sponsor-reservation.create.atomic:v1:*'
  AND OLD.state='processing' AND NEW.state='completed'
  AND (
    NEW.response_status<>201 OR NEW.response_json IS NULL
    OR json_type(NEW.response_json,'$.id')<>'text'
    OR json_type(NEW.response_json,'$.status')<>'text'
    OR json_extract(NEW.response_json,'$.status')<>'draft'
    OR json_type(NEW.response_json,'$.delivery')<>'text'
    OR json_extract(NEW.response_json,'$.delivery')<>'priority_not_guaranteed'
    OR json_type(NEW.response_json,'$.campaignId')<>'text'
    OR json_type(NEW.response_json,'$.placementId')<>'text'
    OR json_type(NEW.response_json,'$.startAt')<>'integer'
    OR json_type(NEW.response_json,'$.endAt')<>'integer'
    OR json_type(NEW.response_json,'$.reservedBudgetJpyMicros')<>'integer'
    OR json_type(NEW.response_json,'$.auditId')<>'text'
    OR json_type(NEW.response_json,'$.createdAt')<>'integer'
    OR json_extract(NEW.response_json,'$.auditId')<>NEW.execution_token
    OR NOT EXISTS (
      SELECT 1 FROM hub_ad_sponsor_reservations r
      JOIN hub_ad_campaigns c ON c.id=r.campaign_id
      JOIN hub_ad_placements p ON p.id=r.placement_id
      JOIN hub_ad_advertisers adv ON adv.advertiser_ref=c.advertiser_ref
      JOIN hub_ad_audit_logs a ON a.id=json_extract(NEW.response_json,'$.auditId')
      WHERE r.id=json_extract(NEW.response_json,'$.id')
        AND NEW.scope='advertiser.sponsor-reservation.create.atomic:v1:' || c.advertiser_ref || ':' || c.id
        AND r.status='draft' AND r.campaign_id=json_extract(NEW.response_json,'$.campaignId')
        AND r.placement_id=json_extract(NEW.response_json,'$.placementId')
        AND r.start_at=json_extract(NEW.response_json,'$.startAt')
        AND r.end_at=json_extract(NEW.response_json,'$.endAt')
        AND r.reserved_budget_jpy_micros=json_extract(NEW.response_json,'$.reservedBudgetJpyMicros')
        AND r.created_at=json_extract(NEW.response_json,'$.createdAt')
        AND c.objective='sponsorship'
        AND c.status IN ('draft','submitted','under_review','needs_changes','approved','scheduled','active','paused')
        AND c.review_status<>'rejected'
        AND r.start_at>r.created_at AND r.start_at>=c.start_at AND r.end_at<=c.end_at
        AND p.status='active' AND r.reserved_budget_jpy_micros>=p.floor_price_jpy_micros
        AND (SELECT COALESCE(SUM(all_r.reserved_budget_jpy_micros),0)
          FROM hub_ad_sponsor_reservations all_r
          WHERE all_r.campaign_id=c.id AND all_r.status<>'cancelled')<=c.total_budget_jpy_micros
        AND NOT EXISTS(SELECT 1 FROM hub_ad_sponsor_reservations occupied
          WHERE occupied.id<>r.id AND occupied.placement_id=r.placement_id
            AND occupied.status IN ('approved','active')
            AND occupied.start_at<r.end_at AND occupied.end_at>r.start_at)
        AND adv.status='active' AND adv.policy_version IS NOT NULL
        AND a.actor_key='advertiser:' || c.advertiser_ref
        AND a.action='sponsor_reservation.created'
        AND a.target_type='sponsor_reservation' AND a.target_id=r.id
        AND a.before_json IS NULL
        AND json_extract(a.after_json,'$.campaignId')=r.campaign_id
        AND json_extract(a.after_json,'$.placementId')=r.placement_id
        AND json_extract(a.after_json,'$.startAt')=r.start_at
        AND json_extract(a.after_json,'$.endAt')=r.end_at
        AND json_extract(a.after_json,'$.reservedBudgetJpyMicros')=r.reserved_budget_jpy_micros
        AND json_extract(a.after_json,'$.status')='draft'
        AND json_extract(a.after_json,'$.delivery')='priority_not_guaranteed'
        AND a.occurred_at=r.created_at
    )
  )
BEGIN
  SELECT RAISE(ABORT,'hub_ad_sponsor_reservation_creation_atomic_graph_incomplete');
END;
