import { NextResponse } from "next/server";

import {
  mediateHubAction,
  parseMediatedActionProposal,
} from "@/lib/platform/mediated-action";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

export async function GET() {
  return NextResponse.json(
    {
      version: "hub.mediation.v1",
      acceptedKinds: ["message-send", "purchase"],
      policy: {
        proposalsOnly: true,
        directMessageSend: false,
        directValueMovement: false,
        messageConfirmation: "required",
        purchasePaymentAuthorization: "required",
      },
    },
    { headers: PRIVATE_HEADERS },
  );
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }
  const proposal = parseMediatedActionProposal(
    await request.json().catch(() => null),
  );
  if (!proposal) {
    return NextResponse.json(
      { error: "invalid_mediation_proposal" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const viewer = await requireHubSessionProfile(request, getHubD1());
    if (proposal.actor.id !== viewer.id) {
      return NextResponse.json(
        { error: "actor_mismatch" },
        { status: 403, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json(
      { mediation: mediateHubAction(proposal) },
      { status: 202, headers: PRIVATE_HEADERS },
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
        { error: "mediation_unavailable" },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }
}
