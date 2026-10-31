import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import {
  requireModerationAdmin,
  requireSameOrigin,
} from "@/lib/server/moderation-admin-auth";
import { parseTrustRequestReviewInput } from "@/lib/trust-request-review-input";

type AdminTrustRequestRow = {
  id: string;
  context: string;
  sourceService: string;
  evidenceLabel: string;
  requestType: string;
  message: string;
  status: string;
  resolutionNote: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request);
  if (denied) return denied;
  try {
    const rows = await getHubD1().prepare(
      `SELECT id,context,source_service sourceService,
              evidence_label evidenceLabel,request_type requestType,message,
              status,resolution_note resolutionNote,created_at createdAt,
              updated_at updatedAt,resolved_at resolvedAt
       FROM hub_trust_requests
       ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
         updated_at DESC
       LIMIT 200`,
    ).all<AdminTrustRequestRow>();
    return NextResponse.json(
      { requests: rows.results },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return errorResponse("trust_requests_unavailable", 503);
  }
}

export async function PATCH(request: Request) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const input = parseTrustRequestReviewInput(await request.json().catch(() => null));
  if (!input) return errorResponse("invalid_trust_request_review", 400);

  const nextStatus = input.action === "start_review" ? "in_review" : input.action === "accept" ? "accepted" : "rejected";
  const eventType = input.action === "start_review" ? "review_started" : input.action === "accept" ? "accepted" : "rejected";
  const previousStatuses = input.action === "start_review" ? "('pending')" : "('pending','in_review')";
  const now = new Date().toISOString();

  try {
    const database = getHubD1();
    const results = await database.batch([
      database.prepare(
        `UPDATE hub_trust_requests
         SET status=?,resolution_note=?,updated_at=?,
             resolved_at=CASE WHEN ?='in_review' THEN NULL ELSE ? END
         WHERE id=? AND status IN ${previousStatuses}`,
      ).bind(nextStatus, input.note, now, nextStatus, now, input.id),
      database.prepare(
        `INSERT INTO hub_trust_request_events
         (id,request_id,actor_scope,event_type,created_at)
         SELECT ?,id,'reviewer',?,?
         FROM hub_trust_requests
         WHERE id=? AND status=? AND updated_at=?`,
      ).bind(crypto.randomUUID(), eventType, now, input.id, nextStatus, now),
    ]);
    if (!Number(results[0].meta.changes ?? 0)) {
      return errorResponse("trust_request_state_conflict", 409);
    }
    return NextResponse.json({ updated: true, status: nextStatus });
  } catch {
    return errorResponse("trust_request_review_failed", 503);
  }
}
