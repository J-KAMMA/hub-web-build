import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { reviewHubAdTrafficFlag, type HubAdTrafficReviewDecision } from "@/lib/server/hub-ads-traffic-review";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;

  const reviewId = (await params).id;
  const operationId = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { decision?: unknown; note?: unknown } | null;
  const decision = String(body?.decision) as HubAdTrafficReviewDecision;
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (
    !UUID.test(reviewId)
    || !UUID.test(operationId)
    || !["reviewed", "dismissed"].includes(decision)
    || note.length < 5
    || note.length > 1_000
  ) {
    return NextResponse.json({ error: "invalid_review" }, { status: 400, headers: NO_STORE });
  }

  const result = await reviewHubAdTrafficFlag(getHubD1(), { reviewId, operationId, decision, note });
  if (result.status === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: result.reason }, { status: 409, headers: NO_STORE });
  }
  return NextResponse.json({ updated: true, receipt: result.receipt }, { headers: NO_STORE });
}
