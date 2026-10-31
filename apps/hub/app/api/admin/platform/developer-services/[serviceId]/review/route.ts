import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { reviewDeveloperService } from "@/lib/server/d1-developer-services";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request, context: { params: Promise<{ serviceId: string }> }) {
  if (requireModerationAdmin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const body = await request.json().catch(() => null) as { decision?: unknown; note?: unknown } | null;
  const decision = body?.decision === "approved"
    || body?.decision === "changes_requested"
    || body?.decision === "suspended"
    ? body.decision
    : null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2000) : "";
  if (!decision || (decision !== "approved" && note.length < 10)) {
    return NextResponse.json({ error: "invalid_review" }, { status: 400 });
  }
  const { serviceId } = await context.params;
  const updated = await reviewDeveloperService(getHubD1(), serviceId, { decision, note });
  return updated
    ? NextResponse.json({ updated: true })
    : NextResponse.json({ error: "invalid_transition" }, { status: 409 });
}
