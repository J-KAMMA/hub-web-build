ALTER TABLE profile_recovery_claims ADD COLUMN consumption_jti TEXT;

CREATE UNIQUE INDEX profile_recovery_claims_consumption_jti_unique
  ON profile_recovery_claims(consumption_jti)
  WHERE consumption_jti IS NOT NULL;

CREATE TRIGGER ProfileRecoveryClaimInsertGuard
BEFORE INSERT ON profile_recovery_claims
WHEN NEW.used_at IS NOT NULL OR NEW.consumption_jti IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'profile_recovery_claim_insert_invalid');
END;

CREATE TRIGGER ProfileRecoveryClaimBindingImmutable
BEFORE UPDATE ON profile_recovery_claims
WHEN NEW.token_hash IS NOT OLD.token_hash
  OR NEW.profile_id IS NOT OLD.profile_id
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT,'profile_recovery_claim_binding_immutable');
END;

CREATE TRIGGER ProfileRecoveryClaimConsumptionGuard
BEFORE UPDATE OF used_at,consumption_jti ON profile_recovery_claims
WHEN NEW.used_at IS NOT OLD.used_at
  OR NEW.consumption_jti IS NOT OLD.consumption_jti
BEGIN
  SELECT RAISE(ABORT, 'profile_recovery_claim_consumption_invalid') WHERE NOT ( OLD.used_at IS NULL AND OLD.consumption_jti IS NULL AND NEW.used_at IS NOT NULL AND NEW.consumption_jti IS NOT NULL AND NEW.consumption_jti GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]' AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.used_at)=NEW.used_at AND NEW.used_at<OLD.expires_at );
END;
