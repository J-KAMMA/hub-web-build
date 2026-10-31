import { NextResponse } from "next/server";

import { mutateFederatedServiceOperation } from "@/lib/server/federation-gateway";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  try {
    const body = await request.json().catch(() => null) as { action?: unknown } | null;
    if (!body || !["confirm", "cancel", "retry"].includes(String(body.action))) {
      return NextResponse.json({ error: "invalid_action" }, { status: 400, headers });
    }
    const profile = await requireHubSessionProfile(request, getHubD1());
    const { requestId } = await context.params;
    const result = await mutateFederatedServiceOperation(profile.id, requestId, body.action as "confirm" | "cancel" | "retry");
    if (!result) return NextResponse.json({ error: "operation_unavailable" }, { status: 409, headers });
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof HubAuthenticationError ? "authentication_required" : "operation_failed" },
      { status: error instanceof HubAuthenticationError ? 401 : 400, headers });
  }
}
