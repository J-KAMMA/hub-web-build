import type { D1Database } from "@cloudflare/workers-types";

export type HubAdSponsorReservationDecision = "approved" | "cancelled";

export type HubAdSponsorReservationReviewReceipt = {
  auditId: string;
  action: "sponsor_reservation.reviewed";
  targetId: string;
  placementId: string;
  startAt: number;
  endAt: number;
  fromStatus: "draft";
  toStatus: HubAdSponsorReservationDecision;
  confirmedAt: number;
  replayed: boolean;
};

export type HubAdSponsorReservationReviewResult =
  | { status: "reviewed" | "replayed"; receipt: HubAdSponsorReservationReviewReceipt }
  | { status: "not_found" }
  | { status: "conflict"; reason: "operation_id_reused" | "already_in_state" | "invalid_transition" | "state_changed" | "placement_already_reserved" };

type ReservationRow = {
  status: string;
  placementId: string;
  startAt: number;
  endAt: number;
};

type ReviewAuditRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  fromStatus: "draft";
  decision: HubAdSponsorReservationDecision;
  reason: string;
  placementId: string;
  startAt: number;
  endAt: number;
  occurredAt: number;
};

async function findOperation(database: D1Database, operationId: string) {
  return database.prepare(`SELECT id,action,target_type targetType,target_id targetId,
      json_extract(before_json,'$.status') fromStatus,
      json_extract(after_json,'$.decision') decision,
      json_extract(after_json,'$.reason') reason,
      json_extract(after_json,'$.placementId') placementId,
      json_extract(after_json,'$.startAt') startAt,
      json_extract(after_json,'$.endAt') endAt,
      occurred_at occurredAt
    FROM hub_ad_audit_logs WHERE id=? LIMIT 1`)
    .bind(operationId).first<ReviewAuditRow>();
}

function receipt(row: ReviewAuditRow, replayed: boolean): HubAdSponsorReservationReviewReceipt {
  return {
    auditId: row.id,
    action: "sponsor_reservation.reviewed",
    targetId: row.targetId,
    placementId: row.placementId,
    startAt: Number(row.startAt),
    endAt: Number(row.endAt),
    fromStatus: "draft",
    toStatus: row.decision,
    confirmedAt: row.occurredAt,
    replayed,
  };
}

function replayResult(
  row: ReviewAuditRow | null,
  input: { reservationId: string; decision: HubAdSponsorReservationDecision; reason: string },
): HubAdSponsorReservationReviewResult | null {
  if (!row) return null;
  if (
    row.action !== "sponsor_reservation.reviewed"
    || row.targetType !== "sponsor_reservation"
    || row.targetId !== input.reservationId
    || row.decision !== input.decision
    || row.reason !== input.reason
  ) return { status: "conflict", reason: "operation_id_reused" };
  return { status: "replayed", receipt: receipt(row, true) };
}

async function hasOverlap(database: D1Database, reservationId: string, reservation: ReservationRow) {
  return Boolean(await database.prepare(`SELECT 1 ok FROM hub_ad_sponsor_reservations
    WHERE id<>? AND placement_id=? AND status IN ('approved','active')
      AND start_at<? AND end_at>? LIMIT 1`)
    .bind(reservationId, reservation.placementId, reservation.endAt, reservation.startAt).first());
}

export async function reviewHubAdSponsorReservation(
  database: D1Database,
  rawInput: { reservationId: string; operationId: string; decision: HubAdSponsorReservationDecision; reason: string },
  now = Date.now(),
): Promise<HubAdSponsorReservationReviewResult> {
  const input = { ...rawInput, reason: rawInput.reason.trim() };
  const existing = replayResult(await findOperation(database, input.operationId), input);
  if (existing) return existing;

  const reservation = await database.prepare(`SELECT status,placement_id placementId,start_at startAt,end_at endAt
    FROM hub_ad_sponsor_reservations WHERE id=?`)
    .bind(input.reservationId).first<ReservationRow>();
  if (!reservation) return { status: "not_found" };
  const afterStateRead = replayResult(await findOperation(database, input.operationId), input);
  if (afterStateRead) return afterStateRead;
  if (reservation.status === input.decision) return { status: "conflict", reason: "already_in_state" };
  if (reservation.status !== "draft") return { status: "conflict", reason: "invalid_transition" };

  try {
    const updated = await database.prepare(`UPDATE hub_ad_sponsor_reservations
      SET status=?,review_reason=?,review_audit_id=?,reviewed_at=?,updated_at=?
      WHERE id=? AND status='draft'`)
      .bind(input.decision, input.reason, input.operationId, now, now, input.reservationId)
      .run();
    if ((updated.meta.changes ?? 0) > 0) {
      const row = await findOperation(database, input.operationId);
      if (!row) throw new Error("hub_ad_sponsor_reservation_review_receipt_missing");
      return { status: "reviewed", receipt: receipt(row, false) };
    }
  } catch {
    const concurrent = replayResult(await findOperation(database, input.operationId), input);
    if (concurrent) return concurrent;
    if (input.decision === "approved" && await hasOverlap(database, input.reservationId, reservation)) {
      return { status: "conflict", reason: "placement_already_reserved" };
    }
  }

  const committedWhileUpdating = replayResult(await findOperation(database, input.operationId), input);
  if (committedWhileUpdating) return committedWhileUpdating;
  return { status: "conflict", reason: "state_changed" };
}
