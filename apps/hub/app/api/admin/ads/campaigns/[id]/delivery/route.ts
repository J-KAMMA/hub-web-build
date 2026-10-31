import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { setHubAdCampaignDelivery, type HubAdCampaignDeliveryAction } from "@/lib/server/hub-ads-campaign-delivery";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (authError) return authError;
  const campaignId = (await params).id;
  const operationId = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { action?: unknown; reason?: unknown } | null;
  const action = String(body?.action) as HubAdCampaignDeliveryAction;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!UUID.test(campaignId) || !UUID.test(operationId)
    || !["activate", "pause"].includes(action)
    || reason.length < 5 || reason.length > 500) {
    return NextResponse.json({ error: "invalid_campaign_delivery" }, { status: 400, headers: NO_STORE });
  }
  const result = await setHubAdCampaignDelivery(getHubD1(), { campaignId, operationId, action, reason });
  if (result.status === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: result.reason }, { status: 409, headers: NO_STORE });
  }
  return NextResponse.json({ updated: true, receipt: result.receipt }, { headers: NO_STORE });
}
