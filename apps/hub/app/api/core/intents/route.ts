import { NextResponse } from "next/server";

import type { HubIntent } from "@/lib/platform/core-model";
import { resolveHubIntent } from "@/lib/platform/capability-catalog";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";
import {
  createIntentRun,
  listIntentRuns,
} from "@/lib/server/d1-intent-orchestrator";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "30", 10);
    return NextResponse.json(
      {
        version: "hub.intent-run.v1",
        runs: await listIntentRuns(database, viewer.id, limit),
      },
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

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }
  const body = (await request.json().catch(() => null)) as HubIntent | null;
  if (!body) {
    return NextResponse.json(
      { error: "intent_required" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const normalizedBody: HubIntent = body.actor?.namespace === "hub"
        && body.actor?.kind === "profile"
        && body.actor?.id === "self"
      ? { ...body, actor: { namespace: "hub", kind: "profile", id: viewer.id } }
      : body;
    if (
      normalizedBody.actor?.namespace !== "hub"
      || normalizedBody.actor?.kind !== "profile"
      || normalizedBody.actor?.id !== viewer.id
    ) {
      return NextResponse.json(
        { error: "actor_mismatch" },
        { status: 403, headers: PRIVATE_HEADERS },
      );
    }
    const resolution = resolveHubIntent(normalizedBody);
    const run = resolution.status === "ready"
      ? await createIntentRun(database, viewer.id, normalizedBody, resolution)
      : null;
    return NextResponse.json(
      { version: "hub.intent-run.v1", resolution, run },
      {
        status: resolution.status === "invalid"
          ? 400
          : resolution.status === "unsupported"
            ? 422
            : 200,
        headers: PRIVATE_HEADERS,
      },
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
        "too_many_intent_constraints",
        "sensitive_intent_constraint",
        "intent_constraint_too_long",
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
