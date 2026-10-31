import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireActiveHubAdvertiser } from "@/lib/server/hub-ads-advertiser-auth";
import { commitHubAdWizardSubmission, prepareHubAdWizardSubmission } from "@/lib/server/hub-ads-advertiser-workflow";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const database = getHubD1();
  const actor = await requireActiveHubAdvertiser(request, database);
  if (!actor) return NextResponse.json({ error: "active_advertiser_required" }, { status: 403 });
  const placements = await database.prepare(`SELECT id,placement_key placementKey,display_name displayName,
    surface_type surfaceType,format,page_category pageCategory,floor_price_jpy_micros floorPriceJpyMicros
    FROM hub_ad_placements WHERE status='active' ORDER BY surface_type,display_name`).all();
  return NextResponse.json({ placements: placements.results }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = requireSameOrigin(request); if (origin) return origin;
  const database = getHubD1();
  const actor = await requireActiveHubAdvertiser(request, database);
  if (!actor) return NextResponse.json({ error: "active_advertiser_required" }, { status: 403, headers: NO_STORE });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_submission" }, { status: 400, headers: NO_STORE });
  }
  const key = request.headers.get("Idempotency-Key");
  const scope = `advertiser.wizard.atomic:v1:${actor.advertiserRef}`;
  const intent = { advertiserRef: actor.advertiserRef, body };
  const existing = await inspectHubAdIdempotency(database, scope, key, intent);
  if (existing?.kind === "replay") return NextResponse.json(existing.body, { status: existing.status, headers: NO_STORE });
  if (existing?.kind === "conflict") return NextResponse.json({ error: existing.reason }, {
    status: existing.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const preparation = await prepareHubAdWizardSubmission(database, actor.advertiserRef, body as Record<string, unknown>);
  if ("error" in preparation) return NextResponse.json(preparation, { status: 400, headers: NO_STORE });
  const reservation = await reserveHubAdAtomicIdempotency(database, scope, key, intent);
  if (reservation.kind === "replay") return NextResponse.json(reservation.body, { status: reservation.status, headers: NO_STORE });
  if (reservation.kind === "conflict") return NextResponse.json({ error: reservation.reason }, {
    status: reservation.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  try {
    const result = await commitHubAdWizardSubmission(database, preparation.prepared, {
      scope, key: key!, executionToken: reservation.executionToken,
    });
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "wizard_submission_unconfirmed", retryWithSameKey: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}
