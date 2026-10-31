import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { createHubAdCampaignAtomically, listHubAdCampaigns, parseHubAdCampaignInput } from "@/lib/server/hub-ads-campaign-admin";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";

const SCOPE = "campaign.create.atomic:v1";
const LEGACY_SCOPE = "campaign.create";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const authError = requireModerationAdmin(request); if (authError) return authError;
  return NextResponse.json({ campaigns: await listHubAdCampaigns(getHubD1()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request); if (authError) return authError;
  const input = parseHubAdCampaignInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Invalid campaign." }, { status: 400, headers: NO_STORE });
  const database = getHubD1(); const key = request.headers.get("Idempotency-Key");
  const legacy = await inspectHubAdIdempotency(database, LEGACY_SCOPE, key, input);
  if (legacy?.kind === "replay") return NextResponse.json(legacy.body, { status: legacy.status, headers: NO_STORE });
  if (legacy?.kind === "conflict") return NextResponse.json({ error: legacy.reason }, {
    status: legacy.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const reservation = await reserveHubAdAtomicIdempotency(database, SCOPE, key, input);
  if (reservation.kind === "replay") return NextResponse.json(reservation.body, { status: reservation.status, headers: NO_STORE });
  if (reservation.kind === "conflict") return NextResponse.json({ error: reservation.reason }, {
    status: reservation.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  try {
    const body = await createHubAdCampaignAtomically(database, input, {
      scope: SCOPE, key: key!, executionToken: reservation.executionToken,
    });
    return NextResponse.json(body, { status: 201, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "campaign_creation_unconfirmed", retryWithSameKey: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}
