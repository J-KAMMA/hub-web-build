import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { advanceStoredIntentRun } from "@/lib/server/d1-intent-orchestrator";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};
const OUTCOMES = new Set(["continue", "handoff", "pause", "complete", "fail"]);

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
    expectedVersion?: unknown;
    outcome?: unknown;
    summary?: unknown;
  } | null;
  if (
    !body
    || !Number.isSafeInteger(body.expectedVersion)
    || (body.outcome !== undefined && !OUTCOMES.has(String(body.outcome)))
    || (
      body.summary !== undefined
      && (
        !body.summary
        || typeof body.summary !== "object"
        || Array.isArray(body.summary)
        || Object.keys(body.summary).length > 20
      )
    )
  ) {
    return NextResponse.json(
      { error: "invalid_transition" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { intentId } = await context.params;
    const run = await advanceStoredIntentRun(database, viewer.id, intentId, {
      expectedVersion: body.expectedVersion as number,
      outcome: body.outcome as
        | "continue"
        | "handoff"
        | "pause"
        | "complete"
        | "fail"
        | undefined,
      summary: body.summary as
        | Record<string, string | number | boolean | null>
        | undefined,
    });
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
      && [
        "intent_version_conflict",
        "intent_run_terminal",
        "approval_required",
        "owner_result_required",
      ].includes(error.message)
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    if (
      error instanceof Error
      && [
        "contract_preview_required",
        "payment_preview_required",
        "too_many_checkpoint_fields",
        "sensitive_checkpoint_field",
        "checkpoint_field_too_long",
      ].includes(error.message)
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }
}
