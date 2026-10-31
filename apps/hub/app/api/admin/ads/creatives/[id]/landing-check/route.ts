import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { processHubAdAdminLandingCheck } from "@/lib/server/hub-ads-admin-landing-check";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request); if (denied) return denied;
  const result = await processHubAdAdminLandingCheck(
    getHubD1(), (await params).id, request.headers.get("Idempotency-Key"),
  );
  if (result.kind === "response") {
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
  }
  if (result.kind === "conflict") return NextResponse.json({ error: result.reason }, {
    status: result.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  return NextResponse.json({ error: "landing_check_unconfirmed", retryWithSameKey: true }, {
    status: 503, headers: NO_STORE,
  });
}
