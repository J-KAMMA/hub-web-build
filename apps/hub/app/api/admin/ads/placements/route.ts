import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { listHubAdPlacements, parseHubAdPlacementInput } from "@/lib/server/hub-ads-admin";
import {
  createHubAdAdminPlacementAtomically,
  prepareHubAdAdminPlacementCreation,
} from "@/lib/server/hub-ads-admin-placement-create";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const authError = requireModerationAdmin(request); if (authError) return authError;
  return NextResponse.json({ placements: await listHubAdPlacements(getHubD1()) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request); if (authError) return authError;
  const input = parseHubAdPlacementInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Invalid placement." }, { status: 400, headers: NO_STORE });
  const database = getHubD1();
  const key = request.headers.get("Idempotency-Key");
  const legacy = await inspectHubAdIdempotency(database, "placement.create", key, input);
  if (legacy?.kind === "replay") return NextResponse.json(legacy.body, { status: legacy.status, headers: NO_STORE });
  if (legacy?.kind === "conflict") return NextResponse.json({ error: legacy.reason }, {
    status: legacy.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const scope = "admin.placement.create.atomic:v1";
  const intent = { input };
  const existing = await inspectHubAdIdempotency(database, scope, key, intent);
  if (existing?.kind === "replay") return NextResponse.json(existing.body, { status: existing.status, headers: NO_STORE });
  if (existing?.kind === "conflict") return NextResponse.json({ error: existing.reason }, {
    status: existing.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const prepared = await prepareHubAdAdminPlacementCreation(database, input);
  if (prepared.kind === "existing") {
    return NextResponse.json({ id: prepared.id, created: false }, { status: 200, headers: NO_STORE });
  }
  if (prepared.kind === "conflict") {
    return NextResponse.json({ error: prepared.reason }, { status: 409, headers: NO_STORE });
  }
  const reservation = await reserveHubAdAtomicIdempotency(database, scope, key, intent);
  if (reservation.kind === "replay") return NextResponse.json(reservation.body, { status: reservation.status, headers: NO_STORE });
  if (reservation.kind === "conflict") return NextResponse.json({ error: reservation.reason }, {
    status: reservation.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  try {
    const result = await createHubAdAdminPlacementAtomically(database, input, {
      scope, key: key!, executionToken: reservation.executionToken,
    });
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "placement_creation_unconfirmed", retryWithSameKey: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}
