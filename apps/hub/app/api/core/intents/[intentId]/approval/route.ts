import { NextResponse } from "next/server";

import type { HubIntentApprovalKind } from "@/lib/platform/intent-orchestrator";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { decideStoredIntentApproval } from "@/lib/server/d1-intent-orchestrator";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};
const KINDS = new Set<HubIntentApprovalKind>([
  "execution",
  "publish",
  "confirmation",
  "contract",
  "payment",
  "personal_data",
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ intentId: string }> },
) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }
  const body = await request.json().catch(() => null) as {
    kind?: unknown;
    decision?: unknown;
    previewHash?: unknown;
  } | null;
  if (
    !body
    || typeof body.kind !== "string"
    || !KINDS.has(body.kind as HubIntentApprovalKind)
    || (body.decision !== "granted" && body.decision !== "denied")
    || (
      body.previewHash !== undefined
      && body.previewHash !== null
      && (typeof body.previewHash !== "string" || body.previewHash.length > 160)
    )
  ) {
    return NextResponse.json(
      { error: "invalid_approval" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { intentId } = await context.params;
    const run = await decideStoredIntentApproval(
      database,
      viewer.id,
      intentId,
      {
        kind: body.kind as HubIntentApprovalKind,
        decision: body.decision,
        previewHash: body.previewHash as string | null | undefined,
      },
    );
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
    if (
      error instanceof Error
      && ["intent_run_terminal", "approval_not_required"].includes(error.message)
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    if (error instanceof Error && error.message === "approval_preview_mismatch") {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }
}
