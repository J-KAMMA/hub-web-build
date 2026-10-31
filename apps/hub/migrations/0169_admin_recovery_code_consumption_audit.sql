ALTER TABLE hub_admin_mfa_recovery_codes
  ADD COLUMN used_audit_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_admin_mfa_recovery_codes_used_audit
  ON hub_admin_mfa_recovery_codes(used_audit_id)
  WHERE used_audit_id IS NOT NULL;

-- A successful emergency-login code consumption is an R3 administrator action.
-- Reject future code paths that try to consume one without an audit identifier.
CREATE TRIGGER IF NOT EXISTS trg_hub_admin_mfa_recovery_code_requires_audit
BEFORE UPDATE OF used_at ON hub_admin_mfa_recovery_codes
WHEN OLD.used_at IS NULL
  AND NEW.used_at IS NOT NULL
  AND (NEW.used_audit_id IS NULL OR length(NEW.used_audit_id) < 16)
BEGIN
  SELECT RAISE(ABORT, 'recovery code consumption requires audit id');
END;

-- The audit insert runs inside the same statement transaction as consumption.
-- It intentionally records neither the plaintext code nor its hash.
CREATE TRIGGER IF NOT EXISTS trg_hub_admin_mfa_recovery_code_consumed_audit
AFTER UPDATE OF used_at ON hub_admin_mfa_recovery_codes
WHEN OLD.used_at IS NULL AND NEW.used_at IS NOT NULL
BEGIN
  INSERT INTO hub_admin_audit_log(
    id,
    actor_role,
    action,
    target_type,
    target_id,
    metadata_json,
    created_at
  ) VALUES(
    NEW.used_audit_id,
    'moderator',
    'consume_recovery_code',
    'moderation_security',
    'recovery_code',
    '{"method":"recovery_code","outcome":"consumed"}',
    NEW.used_at
  );
END;
