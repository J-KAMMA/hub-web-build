-- Pin the creative version before external HTTP and bind the resulting check,
-- moderation audit, and API receipt to the same idempotent operation.

ALTER TABLE hub_ad_landing_checks ADD COLUMN check_source TEXT NOT NULL DEFAULT 'legacy'
  CHECK(check_source IN ('legacy','moderation_admin','maintenance'));

CREATE TABLE IF NOT EXISTS hub_ad_landing_check_operations (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  creative_id TEXT NOT NULL,
  target_state TEXT NOT NULL CHECK(target_state IN ('pinned','missing')),
  creative_version_id TEXT REFERENCES hub_ad_creative_versions(id) ON DELETE RESTRICT,
  url_hash TEXT CHECK(url_hash IS NULL OR length(url_hash)=64),
  state TEXT NOT NULL CHECK(state IN ('processing','completed')),
  response_status INTEGER CHECK(response_status IS NULL OR response_status IN (200,404,409)),
  response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(scope,idempotency_key),
  FOREIGN KEY(scope,idempotency_key)
    REFERENCES hub_ad_admin_idempotency(scope,idempotency_key),
  CHECK((target_state='pinned' AND creative_version_id IS NOT NULL AND url_hash IS NOT NULL)
    OR (target_state='missing' AND creative_version_id IS NULL AND url_hash IS NULL))
);

CREATE TRIGGER IF NOT EXISTS trg_hub_ad_landing_check_operation_guard_update
BEFORE UPDATE ON hub_ad_landing_check_operations
WHEN NOT (OLD.state='processing' AND NEW.state='completed'
  AND OLD.scope=NEW.scope AND OLD.idempotency_key=NEW.idempotency_key
  AND OLD.creative_id=NEW.creative_id AND OLD.target_state=NEW.target_state
  AND OLD.creative_version_id IS NEW.creative_version_id AND OLD.url_hash IS NEW.url_hash
  AND OLD.created_at=NEW.created_at AND NEW.response_status IS NOT NULL AND NEW.response_json IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT,'hub_ad_landing_check_operation_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_hub_ad_landing_check_operation_guard_delete
BEFORE DELETE ON hub_ad_landing_check_operations
BEGIN
  SELECT RAISE(ABORT,'hub_ad_landing_check_operation_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_hub_ad_landing_check_atomic_completion
BEFORE UPDATE OF state,response_status,response_json ON hub_ad_admin_idempotency
WHEN OLD.state='processing' AND NEW.state='completed'
  AND OLD.scope LIKE 'admin.creative.landing-check.atomic:v1:%'
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_landing_check_atomic_graph_incomplete') WHERE NEW.response_status NOT IN (200,404,409) OR NEW.response_json IS NULL OR json_valid(NEW.response_json)=0;
  SELECT RAISE(ABORT, 'hub_ad_landing_check_atomic_graph_incomplete') WHERE NOT EXISTS( SELECT 1 FROM hub_ad_landing_check_operations o WHERE o.scope=OLD.scope AND o.idempotency_key=OLD.idempotency_key AND o.state='completed' AND o.response_status=NEW.response_status AND json(o.response_json)=json(NEW.response_json) AND ((NEW.response_status=404 AND o.target_state='missing' AND json_extract(NEW.response_json,'$.error')='creative_not_found') OR (NEW.response_status=409 AND o.target_state='pinned' AND json_extract(NEW.response_json,'$.error')='creative_version_changed' AND json_extract(NEW.response_json,'$.creativeVersionId')=o.creative_version_id) OR (NEW.response_status=200 AND o.target_state='pinned' AND json_extract(NEW.response_json,'$.creativeVersionId')=o.creative_version_id AND EXISTS( SELECT 1 FROM hub_ad_landing_checks lc JOIN hub_ad_audit_logs a ON a.id=json_extract(NEW.response_json,'$.auditId') AND a.actor_key='moderation-admin' AND a.action='creative.landing_checked' AND a.target_type='creative_version' AND a.target_id=o.creative_version_id AND json(a.after_json)=json(NEW.response_json) WHERE lc.id=json_extract(NEW.response_json,'$.checkId') AND lc.creative_version_id=o.creative_version_id AND lc.url_hash=o.url_hash AND lc.check_source='moderation_admin' AND lc.result=json_extract(NEW.response_json,'$.result') AND lc.reason_code=json_extract(NEW.response_json,'$.reasonCode') AND lc.redirect_count=json_extract(NEW.response_json,'$.redirectCount') AND lc.checked_at=json_extract(NEW.response_json,'$.checkedAt') ))) );
END;
