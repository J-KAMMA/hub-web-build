export const RECOVERY_ROTATION_LEASE_SECONDS = 30;
export const RECOVERY_ROTATION_COOLDOWN_SECONDS = 60;

export const RECOVERY_ROTATION_ACQUIRE_SQL = `
  UPDATE hub_admin_mfa_recovery_rotation_state
  SET operation_id=?, locked_until=?, updated_at=?
  WHERE id=1
    AND (operation_id IS NULL OR locked_until IS NULL OR locked_until < ?)
    AND (last_completed_at IS NULL OR last_completed_at <= ?)
`;

export const RECOVERY_ROTATION_RELEASE_SQL = `
  UPDATE hub_admin_mfa_recovery_rotation_state
  SET operation_id=NULL, locked_until=NULL, updated_at=?
  WHERE id=1 AND operation_id=?
`;

export const RECOVERY_ROTATION_DELETE_CODES_SQL = `
  DELETE FROM hub_admin_mfa_recovery_codes
  WHERE EXISTS(
    SELECT 1 FROM hub_admin_mfa_recovery_rotation_state
    WHERE id=1 AND operation_id=? AND locked_until>=?
  )
`;

export const RECOVERY_ROTATION_INSERT_CODE_SQL = `
  INSERT INTO hub_admin_mfa_recovery_codes(code_hash,created_at)
  SELECT ?,?
  WHERE EXISTS(
    SELECT 1 FROM hub_admin_mfa_recovery_rotation_state
    WHERE id=1 AND operation_id=? AND locked_until>=?
  )
`;

export const RECOVERY_ROTATION_INSERT_AUDIT_SQL = `
  INSERT INTO hub_admin_audit_log(
    id,actor_role,action,target_type,target_id,metadata_json,created_at
  )
  SELECT ?,'moderator','rotate_recovery_codes','moderation_security','recovery_codes',?,?
  WHERE EXISTS(
    SELECT 1 FROM hub_admin_mfa_recovery_rotation_state
    WHERE id=1 AND operation_id=? AND locked_until>=?
  )
`;

export const RECOVERY_ROTATION_FINISH_SQL = `
  UPDATE hub_admin_mfa_recovery_rotation_state
  SET operation_id=NULL, locked_until=NULL, last_completed_at=?, updated_at=?
  WHERE id=1 AND operation_id=? AND locked_until>=?
`;
