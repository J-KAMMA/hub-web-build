import { NextResponse } from "next/server";

import { resolveHubAdReviewAppeal, type HubAdAppealDecision } from "@/lib/server/hub-ads-appeal-resolution";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;

  const id = (await params).id;
  const operationId = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { decision?: unknown; note?: unknown } | null;
  const decision = String(body?.decision) as HubAdAppealDecision;
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!UUID.test(id) || !UUID.test(operationId) || !["accepted", "rejected"].includes(decision) || note.length < 5 || note.length > 1000) {
    return NextResponse.json({ error: "invalid_resolution" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const result = await resolveHubAdReviewAppeal(getHubD1(), { appealId: id, operationId, decision, note });
  if (result.status === "conflict") {
    return NextResponse.json({ error: result.reason }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ updated: true, receipt: result.receipt }, { headers: { "Cache-Control": "no-store" } });
}
