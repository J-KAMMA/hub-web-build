import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { setHubAdsGlobalPause } from "@/lib/server/hub-ads-global-delivery-control";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (authError) return authError;
  const operationId = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { paused?: unknown; reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (typeof body?.paused !== "boolean" || !UUID.test(operationId) || reason.length < 5 || reason.length > 500) {
    return NextResponse.json({ error: "invalid_delivery_control" }, { status: 400, headers: NO_STORE });
  }
  const result = await setHubAdsGlobalPause(getHubD1(), { operationId, paused: body.paused, reason });
  if (result.status === "unavailable") {
    return NextResponse.json({ error: "control_unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: result.reason }, { status: 409, headers: NO_STORE });
  }
  return NextResponse.json({ paused: result.receipt.toPaused, receipt: result.receipt }, { headers: NO_STORE });
}
