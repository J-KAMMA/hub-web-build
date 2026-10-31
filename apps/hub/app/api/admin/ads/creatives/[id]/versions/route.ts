import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  createHubAdAdminCreativeVersionAtomically,
  prepareHubAdAdminCreativeVersion,
} from "@/lib/server/hub-ads-admin-creative-version";
import { parseHubAdCreativeInput } from "@/lib/server/hub-ads-campaign-admin";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request); if (authError) return authError;
  const input = parseHubAdCreativeInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Invalid creative version." }, { status: 400, headers: NO_STORE });
  const creativeId = (await params).id;
  const database = getHubD1();
  const key = request.headers.get("Idempotency-Key");
  const legacy = await inspectHubAdIdempotency(database, `creative.version:${creativeId}`, key, input);
  if (legacy?.kind === "replay") return NextResponse.json(legacy.body, { status: legacy.status, headers: NO_STORE });
  if (legacy?.kind === "conflict") return NextResponse.json({ error: legacy.reason }, {
    status: legacy.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const scope = `admin.creative.version.create.atomic:v1:${creativeId}`;
  const intent = { creativeId, input };
  const existing = await inspectHubAdIdempotency(database, scope, key, intent);
  if (existing?.kind === "replay") return NextResponse.json(existing.body, { status: existing.status, headers: NO_STORE });
  if (existing?.kind === "conflict") return NextResponse.json({ error: existing.reason }, {
    status: existing.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const prepared = await prepareHubAdAdminCreativeVersion(database, creativeId, input);
  if (prepared.kind === "conflict") return NextResponse.json({ error: prepared.reason }, { status: 409, headers: NO_STORE });
  const reservation = await reserveHubAdAtomicIdempotency(database, scope, key, intent);
  if (reservation.kind === "replay") return NextResponse.json(reservation.body, { status: reservation.status, headers: NO_STORE });
  if (reservation.kind === "conflict") return NextResponse.json({ error: reservation.reason }, {
    status: reservation.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  try {
    const body = await createHubAdAdminCreativeVersionAtomically(database, prepared.value, input, {
      scope, key: key!, executionToken: reservation.executionToken,
    });
    return NextResponse.json(body, { status: 201, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "creative_version_creation_unconfirmed", retryWithSameKey: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}
