-- Keep public-report resolution and its moderation audit in one atomic write.
-- User-supplied report detail and delivery tokens are deliberately excluded
-- from the audit payload.
ALTER TABLE hub_ad_public_reports ADD COLUMN resolution_audit_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_public_reports_resolution_audit
  ON hub_ad_public_reports(resolution_audit_id)
  WHERE resolution_audit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS hub_ad_public_report_resolution_requires_audit
BEFORE UPDATE OF status ON hub_ad_public_reports
WHEN OLD.status = 'open' AND NEW.status IN ('reviewed', 'dismissed') AND (
  NEW.resolution_audit_id IS NULL OR NEW.reviewed_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_public_report_resolution_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_public_report_resolution_is_final
BEFORE UPDATE OF status ON hub_ad_public_reports
WHEN OLD.status IN ('reviewed', 'dismissed') AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_public_report_resolution_is_final');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_public_report_resolution_fields_are_final
BEFORE UPDATE OF reviewed_at, resolution_audit_id ON hub_ad_public_reports
WHEN OLD.status IN ('reviewed', 'dismissed') AND (
  NEW.reviewed_at IS NOT OLD.reviewed_at
  OR NEW.resolution_audit_id IS NOT OLD.resolution_audit_id
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_public_report_resolution_fields_are_final');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_public_report_resolution_audit
AFTER UPDATE OF status ON hub_ad_public_reports
WHEN OLD.status = 'open' AND NEW.status IN ('reviewed', 'dismissed')
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.resolution_audit_id,
    'moderation-admin',
    'public_report.' || NEW.status,
    'ad_public_report',
    NEW.id,
    json_object('status', OLD.status),
    json_object('status', NEW.status, 'reasonCode', NEW.reason_code),
    NEW.reviewed_at
  );
END;
