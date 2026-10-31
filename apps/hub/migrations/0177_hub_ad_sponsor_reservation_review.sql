-- Sponsor reservation approval is a consequential allocation of a placement
-- window. Enforce non-overlap and its audit receipt in the same DB statement.
ALTER TABLE hub_ad_sponsor_reservations ADD COLUMN review_reason TEXT;
ALTER TABLE hub_ad_sponsor_reservations ADD COLUMN review_audit_id TEXT;
ALTER TABLE hub_ad_sponsor_reservations ADD COLUMN reviewed_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_ad_sponsor_reservations_review_audit
  ON hub_ad_sponsor_reservations(review_audit_id)
  WHERE review_audit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS hub_ad_sponsor_reservation_must_start_draft
BEFORE INSERT ON hub_ad_sponsor_reservations
WHEN NEW.status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_sponsor_reservation_must_start_draft');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_sponsor_reservation_review_transition_allowed
BEFORE UPDATE OF status ON hub_ad_sponsor_reservations
WHEN OLD.status = 'draft' AND NEW.status NOT IN ('approved', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_sponsor_reservation_review_transition_invalid');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_sponsor_reservation_review_requires_audit
BEFORE UPDATE OF status ON hub_ad_sponsor_reservations
WHEN OLD.status = 'draft' AND NEW.status IN ('approved', 'cancelled') AND (
  NEW.review_audit_id IS NULL
  OR NEW.review_reason IS NULL
  OR length(trim(NEW.review_reason)) NOT BETWEEN 5 AND 1000
  OR NEW.reviewed_at IS NULL
  OR NEW.updated_at <> NEW.reviewed_at
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_sponsor_reservation_review_audit_required');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_sponsor_reservation_approval_no_overlap
BEFORE UPDATE OF status ON hub_ad_sponsor_reservations
WHEN OLD.status = 'draft' AND NEW.status = 'approved' AND EXISTS (
  SELECT 1 FROM hub_ad_sponsor_reservations existing
  WHERE existing.id <> NEW.id
    AND existing.placement_id = NEW.placement_id
    AND existing.status IN ('approved', 'active')
    AND existing.start_at < NEW.end_at
    AND existing.end_at > NEW.start_at
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_sponsor_reservation_placement_already_reserved');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_sponsor_reservation_review_fields_require_transition
BEFORE UPDATE OF review_reason, review_audit_id, reviewed_at
ON hub_ad_sponsor_reservations
WHEN NOT (OLD.status = 'draft' AND NEW.status IN ('approved', 'cancelled')) AND (
  NEW.review_reason IS NOT OLD.review_reason
  OR NEW.review_audit_id IS NOT OLD.review_audit_id
  OR NEW.reviewed_at IS NOT OLD.reviewed_at
)
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_sponsor_reservation_review_fields_require_transition');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_sponsor_reservation_review_decision_final
BEFORE UPDATE OF status ON hub_ad_sponsor_reservations
WHEN OLD.status IN ('approved', 'cancelled')
  AND NEW.status IN ('approved', 'cancelled')
  AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_sponsor_reservation_review_decision_final');
END;

CREATE TRIGGER IF NOT EXISTS hub_ad_sponsor_reservation_review_audit
AFTER UPDATE OF status ON hub_ad_sponsor_reservations
WHEN OLD.status = 'draft' AND NEW.status IN ('approved', 'cancelled')
BEGIN
  INSERT INTO hub_ad_audit_logs(
    id, actor_key, action, target_type, target_id, before_json, after_json, occurred_at
  ) VALUES (
    NEW.review_audit_id,
    'moderation-admin',
    'sponsor_reservation.reviewed',
    'sponsor_reservation',
    NEW.id,
    json_object('status', OLD.status),
    json_object(
      'decision', NEW.status,
      'reason', NEW.review_reason,
      'placementId', NEW.placement_id,
      'startAt', NEW.start_at,
      'endAt', NEW.end_at
    ),
    NEW.reviewed_at
  );
END;
