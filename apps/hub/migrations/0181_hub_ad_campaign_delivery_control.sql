-- Campaign delivery changes can expose paid content. Bind each transition to
-- one operation, re-check every delivery prerequisite inside SQLite, and let
-- triggers move line items and append the audit receipt atomically.
ALTER TABLE hub_ad_campaigns ADD COLUMN delivery_reason TEXT;
ALTER TABLE hub_ad_campaigns ADD COLUMN delivery_audit_id TEXT;
ALTER TABLE hub_ad_campaigns ADD COLUMN delivery_changed_at INTEGER;
ALTER TABLE hub_ad_campaigns ADD COLUMN delivery_version INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_campaigns_delivery_audit
  ON hub_ad_campaigns(delivery_audit_id)
  WHERE delivery_audit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_delivery_transition_allowed
BEFORE UPDATE OF status ON hub_ad_campaigns
WHEN NEW.status <> OLD.status
  AND NEW.status IN ('active', 'paused')
  AND NOT (
  (OLD.status = 'approved' AND NEW.status IN ('active', 'paused'))
  OR (OLD.status = 'paused' AND NEW.status = 'active')
  OR (OLD.status = 'active' AND NEW.status = 'paused')
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_campaign_delivery_transition_invalid');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_delivery_audit_required
BEFORE UPDATE OF status ON hub_ad_campaigns
WHEN NEW.status <> OLD.status
  AND NEW.status IN ('active', 'paused')
  AND (
  NEW.delivery_reason IS NULL
  OR length(trim(NEW.delivery_reason)) NOT BETWEEN 5 AND 500
  OR NEW.delivery_audit_id IS NULL
  OR NEW.delivery_changed_at IS NULL
  OR NEW.updated_at <> NEW.delivery_changed_at
  OR NEW.delivery_version <> OLD.delivery_version + 1
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_campaign_delivery_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_delivery_fields_require_transition
BEFORE UPDATE OF delivery_reason, delivery_audit_id, delivery_changed_at, delivery_version
ON hub_ad_campaigns
WHEN NOT (NEW.status <> OLD.status AND NEW.status IN ('active', 'paused')) AND (
  NEW.delivery_reason IS NOT OLD.delivery_reason
  OR NEW.delivery_audit_id IS NOT OLD.delivery_audit_id
  OR NEW.delivery_changed_at IS NOT OLD.delivery_changed_at
  OR NEW.delivery_version IS NOT OLD.delivery_version
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_campaign_delivery_fields_require_transition');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_activation_requires_ready_inventory
BEFORE UPDATE OF status ON hub_ad_campaigns
WHEN NEW.status = 'active' AND (
  NEW.review_status <> 'approved'
  OR NEW.end_at <= NEW.delivery_changed_at
  OR COALESCE((
    SELECT SUM(x.credited_jpy_micros)
    FROM hub_ad_x402_deposits x
    WHERE x.campaign_id = NEW.id AND x.status = 'settled'
  ), 0) < NEW.total_budget_jpy_micros
  OR NOT EXISTS (
    SELECT 1 FROM hub_ad_line_items li WHERE li.campaign_id = NEW.id
  )
  OR EXISTS (
    SELECT 1 FROM hub_ad_line_items li
    WHERE li.campaign_id = NEW.id
      AND (li.status NOT IN ('draft', 'paused') OR li.end_at <= NEW.delivery_changed_at)
  )
  OR EXISTS (
    SELECT 1 FROM hub_ad_line_items li
    WHERE li.campaign_id = NEW.id
      AND NOT EXISTS (
        SELECT 1 FROM hub_ad_line_item_placements lip
        WHERE lip.line_item_id = li.id
      )
  )
  OR EXISTS (
    SELECT 1
    FROM hub_ad_line_items li
    JOIN hub_ad_line_item_placements lip ON lip.line_item_id = li.id
    JOIN hub_ad_placements p ON p.id = lip.placement_id
    WHERE li.campaign_id = NEW.id AND p.status <> 'active'
  )
  OR EXISTS (
    SELECT 1 FROM hub_ad_line_items li
    WHERE li.campaign_id = NEW.id
      AND NOT EXISTS (
        SELECT 1
        FROM hub_ad_line_item_creatives lic
        JOIN hub_ad_creative_versions cv ON cv.id = lic.creative_version_id
        JOIN hub_ad_creatives cr
          ON cr.id = cv.creative_id AND cr.current_version = cv.version
        WHERE lic.line_item_id = li.id
          AND cv.review_status = 'approved'
          AND cr.status = 'approved'
      )
  )
  OR EXISTS (
    SELECT 1
    FROM hub_ad_line_items li
    JOIN hub_ad_line_item_creatives lic ON lic.line_item_id = li.id
    JOIN hub_ad_creative_versions cv ON cv.id = lic.creative_version_id
    JOIN hub_ad_creatives cr ON cr.id = cv.creative_id
    WHERE li.campaign_id = NEW.id
      AND (
        cv.review_status <> 'approved'
        OR cr.status <> 'approved'
        OR cr.current_version <> cv.version
      )
  )
  OR EXISTS (
    SELECT 1
    FROM hub_ad_line_items li
    JOIN hub_ad_line_item_creatives lic ON lic.line_item_id = li.id
    WHERE li.campaign_id = NEW.id
      AND NOT EXISTS (
        SELECT 1 FROM hub_ad_landing_checks lc
        WHERE lc.creative_version_id = lic.creative_version_id
          AND lc.result = 'passed'
          AND lc.checked_at >= NEW.delivery_changed_at - 86400000
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_campaign_not_ready');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_campaign_delivery_applied
AFTER UPDATE OF status ON hub_ad_campaigns
WHEN NEW.status <> OLD.status AND NEW.status IN ('active', 'paused')
BEGIN
  UPDATE hub_ad_line_items
    SET status = CASE WHEN NEW.status = 'active' THEN 'active' ELSE 'paused' END,
        updated_at = NEW.delivery_changed_at
    WHERE campaign_id = NEW.id
      AND (
        (NEW.status = 'active' AND status IN ('draft', 'paused'))
        OR (NEW.status = 'paused' AND status = 'active')
      );

  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.delivery_audit_id,
    'moderation-admin',
    CASE WHEN NEW.status = 'active' THEN 'campaign.activated' ELSE 'campaign.paused' END,
    'campaign',
    NEW.id,
    json_object('status', OLD.status, 'version', OLD.delivery_version),
    json_object('status', NEW.status, 'reason', NEW.delivery_reason, 'version', NEW.delivery_version),
    NEW.delivery_changed_at
  );
END;
