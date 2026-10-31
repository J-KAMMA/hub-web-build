import { NextResponse } from "next/server";

import { resolveHubAdPublicReport, type HubAdPublicReportDecision } from "@/lib/server/hub-ads-public-report-resolution";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;

  const id = (await params).id;
  const operationId = request.headers.get("Idempotency-Key")?.trim() ?? "";
  const body = await request.json().catch(() => null) as { decision?: unknown } | null;
  const decision = String(body?.decision) as HubAdPublicReportDecision;
  if (!UUID.test(id) || !UUID.test(operationId) || !["reviewed", "dismissed"].includes(decision)) {
    return NextResponse.json({ error: "invalid_resolution" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const result = await resolveHubAdPublicReport(getHubD1(), { reportId: id, operationId, decision });
  if (result.status === "conflict") {
    return NextResponse.json({ error: result.reason }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ updated: true, receipt: result.receipt }, { headers: { "Cache-Control": "no-store" } });
}
