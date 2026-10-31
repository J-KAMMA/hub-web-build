import { NextResponse } from "next/server";

import { getIntentRun } from "@/lib/server/d1-intent-orchestrator";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";
import { signIntentHandoffProof } from "@/lib/server/intent-handoff-proof";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(
  request: Request,
  context: { params: Promise<{ intentId: string }> },
) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers: HEADERS });
  }
  const body = await request.json().catch(() => null) as { service?: unknown } | null;
  const service = body?.service === "ai"
    ? "jkamma-ai"
    : body?.service === "commerce"
      ? "jkamma-commerce"
      : null;
  if (!service) {
    return NextResponse.json({ error: "invalid_owner_service" }, { status: 400, headers: HEADERS });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { intentId } = await context.params;
    const run = await getIntentRun(database, viewer.id, intentId);
    if (!run) {
      return NextResponse.json({ error: "intent_not_found" }, { status: 404, headers: HEADERS });
    }
    const privateKey = process.env.HUB_INTENT_HANDOFF_PRIVATE_KEY_PKCS8?.trim();
    if (!privateKey) {
      return NextResponse.json(
        { error: "intent_handoff_signing_unavailable" },
        { status: 503, headers: HEADERS },
      );
    }
    const proof = await signIntentHandoffProof(run, service, privateKey);
    return NextResponse.json({ proof, expiresInSeconds: 120 }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401, headers: HEADERS });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "intent_service_unavailable" }, { status: 503, headers: HEADERS });
    }
    if (error instanceof Error && error.message === "intent_handoff_not_ready") {
      return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    }
    throw error;
  }
}
