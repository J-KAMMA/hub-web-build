import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  attachHubAdAdminCreativeAtomically,
  prepareHubAdAdminCreativeAttachment,
} from "@/lib/server/hub-ads-admin-creative-attachment";
import { inspectHubAdIdempotency, reserveHubAdAtomicIdempotency } from "@/lib/server/hub-ads-idempotency";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request); if (authError) return authError;
  const body = await request.json().catch(() => null) as { creativeId?: unknown } | null;
  if (typeof body?.creativeId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(body.creativeId)) {
    return NextResponse.json({ error: "A valid creative ID is required." }, { status: 400, headers: NO_STORE });
  }
  const lineItemId = (await params).id;
  const database = getHubD1();
  const key = request.headers.get("Idempotency-Key");
  const scope = `admin.creative.attach.atomic:v1:${lineItemId}`;
  const intent = { lineItemId, creativeId: body.creativeId };
  const existing = await inspectHubAdIdempotency(database, scope, key, intent);
  if (existing?.kind === "replay") return NextResponse.json(existing.body, { status: existing.status, headers: NO_STORE });
  if (existing?.kind === "conflict") return NextResponse.json({ error: existing.reason }, {
    status: existing.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  const prepared = await prepareHubAdAdminCreativeAttachment(database, lineItemId, body.creativeId);
  if (prepared.kind === "conflict") {
    return NextResponse.json({ error: prepared.reason }, { status: 409, headers: NO_STORE });
  }
  const reservation = await reserveHubAdAtomicIdempotency(database, scope, key, intent);
  if (reservation.kind === "replay") return NextResponse.json(reservation.body, { status: reservation.status, headers: NO_STORE });
  if (reservation.kind === "conflict") return NextResponse.json({ error: reservation.reason }, {
    status: reservation.reason === "invalid_key" ? 400 : 409, headers: NO_STORE,
  });
  try {
    const result = await attachHubAdAdminCreativeAtomically(database, prepared.value, {
      scope, key: key!, executionToken: reservation.executionToken,
    });
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "creative_attachment_unconfirmed", retryWithSameKey: true }, {
      status: 503, headers: NO_STORE,
    });
  }
}
