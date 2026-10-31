-- Placement activation changes live inventory. Make transitions explicit and
-- bind their reason, optimistic version, and audit receipt atomically.
ALTER TABLE hub_ad_placements ADD COLUMN status_reason TEXT;
ALTER TABLE hub_ad_placements ADD COLUMN status_audit_id TEXT;
ALTER TABLE hub_ad_placements ADD COLUMN status_changed_at INTEGER;
ALTER TABLE hub_ad_placements ADD COLUMN status_version INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_placements_status_audit
  ON hub_ad_placements(status_audit_id)
  WHERE status_audit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS hub_ad_placement_must_start_draft
BEFORE INSERT ON hub_ad_placements
WHEN NEW.status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_placement_must_start_draft');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_placement_status_transition_allowed
BEFORE UPDATE OF status ON hub_ad_placements
WHEN NEW.status = OLD.status OR NOT (
  (OLD.status = 'draft' AND NEW.status IN ('active', 'archived'))
  OR (OLD.status = 'active' AND NEW.status IN ('paused', 'archived'))
  OR (OLD.status = 'paused' AND NEW.status IN ('active', 'archived'))
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_placement_status_transition_invalid');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_placement_status_audit_required
BEFORE UPDATE OF status ON hub_ad_placements
WHEN (
  NEW.status_reason IS NULL
  OR length(trim(NEW.status_reason)) NOT BETWEEN 5 AND 500
  OR NEW.status_audit_id IS NULL
  OR NEW.status_changed_at IS NULL
  OR NEW.updated_at <> NEW.status_changed_at
  OR NEW.status_version <> OLD.status_version + 1
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_placement_status_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_placement_status_fields_require_transition
BEFORE UPDATE OF status_reason, status_audit_id, status_changed_at, status_version
ON hub_ad_placements
WHEN NEW.status = OLD.status AND (
  NEW.status_reason IS NOT OLD.status_reason
  OR NEW.status_audit_id IS NOT OLD.status_audit_id
  OR NEW.status_changed_at IS NOT OLD.status_changed_at
  OR NEW.status_version IS NOT OLD.status_version
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_placement_status_fields_require_transition');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_placement_status_audit
AFTER UPDATE OF status ON hub_ad_placements
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.status_audit_id,
    'moderation-admin',
    'placement.status_changed',
    'placement',
    NEW.id,
    json_object('status', OLD.status, 'version', OLD.status_version),
    json_object('status', NEW.status, 'reason', NEW.status_reason, 'version', NEW.status_version),
    NEW.status_changed_at
  );
END;
