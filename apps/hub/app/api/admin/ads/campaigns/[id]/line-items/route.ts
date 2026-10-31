import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  createHubAdAdminLineItemAtomically,
  prepareHubAdAdminLineItemCreation,
} from "@/lib/server/hub-ads-admin-line-item-create";
import { parseHubAdLineItemInput } from "@/lib/server/hub-ads-campaign-admin";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request); if (authError) return authError;
  const input = parseHubAdLineItemInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Invalid line item." }, { status: 400, headers: NO_STORE });
  const campaignId = (await params).id;
  const database = getHubD1();
  const key = request.headers.get("Idempotency-Key");
  const legacyScope = `line_item.create:${campaignId}`;
  const legacy = await inspectHubAdIdempotency(database, legacyScope, key, input);
  if (legacy?.kind === "replay") return NextResponse.json(legacy.body, { status: legacy.status, headers: NO_STORE });
  if (legacy?.kind === "conflict") return NextResponse.json({ error: legacy.reason }, {
    status: legacy.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const scope = `admin.line_item.create.atomic:v1:${campaignId}`;
  const intent = { campaignId, input };
  const existing = await inspectHubAdIdempotency(database, scope, key, intent);
  if (existing?.kind === "replay") return NextResponse.json(existing.body, { status: existing.status, headers: NO_STORE });
  if (existing?.kind === "conflict") return NextResponse.json({ error: existing.reason }, {
    status: existing.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const prepared = await prepareHubAdAdminLineItemCreation(database, campaignId, input);
  if (prepared.kind === "conflict") {
    return NextResponse.json({ error: prepared.reason }, { status: 409, headers: NO_STORE });
  }
  const reservation = await reserveHubAdAtomicIdempotency(database, scope, key, intent);
  if (reservation.kind === "replay") return NextResponse.json(reservation.body, { status: reservation.status, headers: NO_STORE });
  if (reservation.kind === "conflict") return NextResponse.json({ error: reservation.reason }, {
    status: reservation.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  try {
    const body = await createHubAdAdminLineItemAtomically(database, campaignId, input, {
      scope, key: key!, executionToken: reservation.executionToken,
    });
    return NextResponse.json(body, { status: 201, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "line_item_creation_unconfirmed", retryWithSameKey: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}
