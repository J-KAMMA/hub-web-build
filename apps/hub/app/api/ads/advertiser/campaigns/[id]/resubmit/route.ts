import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireActiveHubAdvertiser } from "@/lib/server/hub-ads-advertiser-auth";
import {
  prepareHubAdCampaignResubmission,
  resubmitHubAdCampaignAtomically,
} from "@/lib/server/hub-ads-campaign-resubmission";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = requireSameOrigin(request); if (origin) return origin;
  const database = getHubD1();
  const actor = await requireActiveHubAdvertiser(request, database);
  if (!actor) return NextResponse.json({ error: "active_advertiser_required" }, { status: 403, headers: NO_STORE });
  const { id } = await params;
  const key = request.headers.get("Idempotency-Key");
  const scope = `advertiser.campaign.resubmit.atomic:v1:${actor.advertiserRef}:${id}`;
  const intent = { advertiserRef: actor.advertiserRef, campaignId: id };
  const existing = await inspectHubAdIdempotency(database, scope, key, intent);
  if (existing?.kind === "replay") return NextResponse.json(existing.body, { status: existing.status, headers: NO_STORE });
  if (existing?.kind === "conflict") return NextResponse.json({ error: existing.reason }, {
    status: existing.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const prepared = await prepareHubAdCampaignResubmission(database, id, actor.advertiserRef);
  if (!prepared) return NextResponse.json({ error: "campaign_not_resubmittable" }, { status: 409, headers: NO_STORE });
  const reservation = await reserveHubAdAtomicIdempotency(database, scope, key, intent);
  if (reservation.kind === "replay") return NextResponse.json(reservation.body, { status: reservation.status, headers: NO_STORE });
  if (reservation.kind === "conflict") return NextResponse.json({ error: reservation.reason }, {
    status: reservation.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  try {
    const body = await resubmitHubAdCampaignAtomically(database, prepared, {
      scope, key: key!, executionToken: reservation.executionToken,
    });
    return NextResponse.json(body, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "campaign_resubmission_unconfirmed", retryWithSameKey: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}
