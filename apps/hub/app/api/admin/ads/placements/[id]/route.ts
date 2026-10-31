import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { setHubAdPlacementStatus, type HubAdPlacementStatus } from "@/lib/server/hub-ads-placement-status";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (authError) return authError;
  const placementId = (await params).id;
  const operationId = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { status?: unknown; reason?: unknown } | null;
  const nextStatus = String(body?.status) as HubAdPlacementStatus;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!UUID.test(placementId) || !UUID.test(operationId)
    || !["active", "paused", "archived"].includes(nextStatus)
    || reason.length < 5 || reason.length > 500) {
    return NextResponse.json({ error: "invalid_placement_status" }, { status: 400, headers: NO_STORE });
  }
  const result = await setHubAdPlacementStatus(getHubD1(), { placementId, operationId, nextStatus, reason });
  if (result.status === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: result.reason }, { status: 409, headers: NO_STORE });
  }
  return NextResponse.json({ updated: true, receipt: result.receipt }, { headers: NO_STORE });
}
