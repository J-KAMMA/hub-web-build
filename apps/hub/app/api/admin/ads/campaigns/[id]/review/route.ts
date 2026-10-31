import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { reviewHubAdCampaign, type HubAdCampaignReviewDecision } from "@/lib/server/hub-ads-campaign-review";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (authError) return authError;

  const campaignId = (await params).id;
  const operationId = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { decision?: unknown; reason?: unknown } | null;
  const decision = String(body?.decision) as HubAdCampaignReviewDecision;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (
    !OPERATION_ID.test(campaignId)
    || !OPERATION_ID.test(operationId)
    || !["approved", "needs_changes", "rejected"].includes(decision)
    || reason.length < 5
    || reason.length > 1_000
  ) {
    return NextResponse.json({ error: "invalid_review" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const result = await reviewHubAdCampaign(getHubD1(), { campaignId, operationId, decision, reason });
  if (result.status === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: result.reason }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ updated: true, receipt: result.receipt }, { headers: { "Cache-Control": "no-store" } });
}
