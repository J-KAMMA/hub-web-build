import { NextResponse } from "next/server";

import { getIntentRun } from "@/lib/server/d1-intent-orchestrator";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ intentId: string }> },
) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { intentId } = await context.params;
    const run = await getIntentRun(database, viewer.id, intentId);
    if (!run) {
      return NextResponse.json(
        { error: "intent_not_found" },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json(
      { version: "hub.intent-run.v1", run },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json(
        { error: "authentication_required" },
        { status: 401, headers: PRIVATE_HEADERS },
      );
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "intent_service_unavailable" },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }
}
