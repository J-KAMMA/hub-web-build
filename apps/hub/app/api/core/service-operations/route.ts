import { NextResponse } from "next/server";

import {
  listFederatedServiceOperations,
  prepareFederatedServiceOperation,
  type FederatedServiceOperation,
} from "@/lib/server/federation-gateway";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const capabilities = new Set<FederatedServiceOperation["capability"]>([
  "social", "knowledge", "commerce", "payment", "delivery", "vault", "media", "ai", "secure-data",
]);

export async function GET(request: Request) {
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    return NextResponse.json({ operations: await listFederatedServiceOperations(profile.id) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof HubAuthenticationError ? "authentication_required" : "federation_unavailable" },
      { status: error instanceof HubAuthenticationError ? 401 : 503, headers });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.remoteActorId !== "string" || typeof body.targetInboxUrl !== "string"
      || !capabilities.has(String(body.capability) as FederatedServiceOperation["capability"])
      || typeof body.action !== "string" || typeof body.idempotencyKey !== "string") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
    }
    const profile = await requireHubSessionProfile(request, getHubD1());
    const result = await prepareFederatedServiceOperation(profile.id, {
      remoteActorId: body.remoteActorId,
      targetInboxUrl: body.targetInboxUrl,
      capability: body.capability as FederatedServiceOperation["capability"],
      action: body.action,
      resource: typeof body.resource === "string" ? body.resource : undefined,
      inputRef: typeof body.inputRef === "string" ? body.inputRef : undefined,
      callback: typeof body.callback === "string" ? body.callback : undefined,
      idempotencyKey: body.idempotencyKey,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
    });
    if (!result) return NextResponse.json({ error: "federation_unavailable" }, { status: 503, headers });
    return NextResponse.json(result, { status: result.operation.reused ? 200 : 201, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof HubAuthenticationError ? "authentication_required" : "operation_failed" },
      { status: error instanceof HubAuthenticationError ? 401 : 400, headers });
  }
}
