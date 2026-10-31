import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireActiveHubAdvertiser } from "@/lib/server/hub-ads-advertiser-auth";
import {
  createHubAdvertiserCreativeAtomically,
  parseHubAdCreativeInput,
  resolveHubAdImageAssetPath,
} from "@/lib/server/hub-ads-campaign-admin";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const origin = requireSameOrigin(request); if (origin) return origin;
  const database = getHubD1();
  const actor = await requireActiveHubAdvertiser(request, database);
  if (!actor) return NextResponse.json({ error: "active_advertiser_required" }, { status: 403, headers: NO_STORE });
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "invalid_creative" }, { status: 400, headers: NO_STORE });
  }
  const key = request.headers.get("Idempotency-Key");
  const scope = `advertiser.creative.create.atomic:v1:${actor.advertiserRef}`;
  const intent = { advertiserRef: actor.advertiserRef, body: raw };
  const existing = await inspectHubAdIdempotency(database, scope, key, intent);
  if (existing?.kind === "replay") return NextResponse.json(existing.body, { status: existing.status, headers: NO_STORE });
  if (existing?.kind === "conflict") return NextResponse.json({ error: existing.reason }, {
    status: existing.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const input = parseHubAdCreativeInput({ ...raw, advertiserRef: actor.advertiserRef });
  if (!input) return NextResponse.json({ error: "invalid_creative" }, { status: 400, headers: NO_STORE });
  if (await resolveHubAdImageAssetPath(database, input) === undefined) {
    return NextResponse.json({ error: "asset_not_owned_or_clean" }, { status: 409, headers: NO_STORE });
  }
  const reservation = await reserveHubAdAtomicIdempotency(database, scope, key, intent);
  if (reservation.kind === "replay") return NextResponse.json(reservation.body, { status: reservation.status, headers: NO_STORE });
  if (reservation.kind === "conflict") return NextResponse.json({ error: reservation.reason }, {
    status: reservation.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  try {
    const body = await createHubAdvertiserCreativeAtomically(database, input, {
      scope, key: key!, executionToken: reservation.executionToken,
    });
    return NextResponse.json(body, { status: 201, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "creative_creation_unconfirmed", retryWithSameKey: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}
