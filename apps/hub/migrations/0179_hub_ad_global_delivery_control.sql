-- Global resume can expose ads immediately. Require an optimistic version,
-- a unique operation receipt, and an audit row in the same DB statement.
ALTER TABLE hub_ad_system_controls ADD COLUMN control_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hub_ad_system_controls ADD COLUMN change_audit_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_system_controls_change_audit
  ON hub_ad_system_controls(change_audit_id)
  WHERE change_audit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS hub_ad_global_control_singleton_insert_blocked
BEFORE INSERT ON hub_ad_system_controls
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_global_control_singleton_insert_blocked');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_global_control_delete_blocked
BEFORE DELETE ON hub_ad_system_controls
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_global_control_delete_blocked');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_global_control_state_change_required
BEFORE UPDATE ON hub_ad_system_controls
WHEN NEW.ads_paused = OLD.ads_paused
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_global_control_state_change_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_global_control_audit_required
BEFORE UPDATE ON hub_ad_system_controls
WHEN (
  NEW.control_key <> 'global'
  OR NEW.change_audit_id IS NULL
  OR NEW.reason IS NULL
  OR length(trim(NEW.reason)) NOT BETWEEN 5 AND 500
  OR NEW.changed_by_actor_key <> 'moderation-admin'
  OR NEW.changed_at IS NULL
  OR NEW.control_version <> OLD.control_version + 1
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_global_control_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_global_control_audit
AFTER UPDATE ON hub_ad_system_controls
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.change_audit_id,
    'moderation-admin',
    CASE WHEN NEW.ads_paused = 1 THEN 'ads.paused' ELSE 'ads.resumed' END,
    'system',
    'global',
    json_object('paused', OLD.ads_paused = 1, 'reason', OLD.reason, 'version', OLD.control_version),
    json_object('paused', NEW.ads_paused = 1, 'reason', NEW.reason, 'version', NEW.control_version),
    NEW.changed_at
  );
END;
