import { NextResponse } from "next/server";

import { applyStoredIntentOwnerResult } from "@/lib/server/d1-intent-orchestrator";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { verifyIntentOwnerResultProof } from "@/lib/server/intent-owner-result-proof";

const HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { proof?: unknown } | null;
  const proof = await verifyIntentOwnerResultProof(
    body?.proof,
    {
      "jkamma-ai": process.env.AI_INTENT_RESULT_PUBLIC_KEY_SPKI,
      "jkamma-commerce": process.env.COMMERCE_INTENT_RESULT_PUBLIC_KEY_SPKI,
    },
  );
  if (!proof) {
    return NextResponse.json(
      { error: "invalid_owner_result_proof" },
      { status: 401, headers: HEADERS },
    );
  }
  try {
    const run = await applyStoredIntentOwnerResult(getHubD1(), proof);
    if (!run) {
      return NextResponse.json(
        { error: "intent_not_found" },
        { status: 404, headers: HEADERS },
      );
    }
    return NextResponse.json(
      { version: "hub.intent-run.v1", accepted: true, run },
      { headers: HEADERS },
    );
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "intent_service_unavailable" },
        { status: 503, headers: HEADERS },
      );
    }
    if (
      error instanceof Error
      && [
        "owner_result_replayed",
        "owner_result_stage_mismatch",
        "owner_result_not_expected",
        "intent_version_conflict",
      ].includes(error.message)
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 409, headers: HEADERS },
      );
    }
    throw error;
  }
}
