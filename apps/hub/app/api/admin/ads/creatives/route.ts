import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  createHubAdAdminCreativeAtomically,
  prepareHubAdAdminCreativeCreation,
} from "@/lib/server/hub-ads-admin-creative-create";
import { listHubAdCreatives, parseHubAdCreativeInput } from "@/lib/server/hub-ads-campaign-admin";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const authError = requireModerationAdmin(request); if (authError) return authError;
  return NextResponse.json({ creatives: await listHubAdCreatives(getHubD1()) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request); if (authError) return authError;
  const input = parseHubAdCreativeInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({
    error: "素材の入力が正しくありません。静止画像にはスキャン済みアセットが必要です。",
  }, { status: 400, headers: NO_STORE });
  const database = getHubD1();
  const key = request.headers.get("Idempotency-Key");
  const legacy = await inspectHubAdIdempotency(database, "creative.create", key, input);
  if (legacy?.kind === "replay") return NextResponse.json(legacy.body, { status: legacy.status, headers: NO_STORE });
  if (legacy?.kind === "conflict") return NextResponse.json({ error: legacy.reason }, {
    status: legacy.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const scope = "admin.creative.create.atomic:v1";
  const intent = { input };
  const existing = await inspectHubAdIdempotency(database, scope, key, intent);
  if (existing?.kind === "replay") return NextResponse.json(existing.body, { status: existing.status, headers: NO_STORE });
  if (existing?.kind === "conflict") return NextResponse.json({ error: existing.reason }, {
    status: existing.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const prepared = await prepareHubAdAdminCreativeCreation(database, input);
  if (prepared.kind === "conflict") return NextResponse.json({ error: prepared.reason }, { status: 409, headers: NO_STORE });
  const reservation = await reserveHubAdAtomicIdempotency(database, scope, key, intent);
  if (reservation.kind === "replay") return NextResponse.json(reservation.body, { status: reservation.status, headers: NO_STORE });
  if (reservation.kind === "conflict") return NextResponse.json({ error: reservation.reason }, {
    status: reservation.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  try {
    const body = await createHubAdAdminCreativeAtomically(database, input, {
      scope, key: key!, executionToken: reservation.executionToken,
    });
    return NextResponse.json(body, { status: 201, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "creative_creation_unconfirmed", retryWithSameKey: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}
