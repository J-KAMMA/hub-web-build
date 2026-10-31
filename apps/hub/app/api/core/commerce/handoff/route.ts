import { NextResponse } from "next/server";

import {
  createHubCommerceHandoff,
  parseHubCommerceProposal,
} from "@/lib/platform/universal-commerce";
import { commerceApiUrl } from "@/lib/commerce-client";
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

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }
  const proposal = parseHubCommerceProposal(
    await request.json().catch(() => null),
  );
  if (!proposal) {
    return NextResponse.json(
      { error: "invalid_commerce_proposal" },
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
    const handoff = createHubCommerceHandoff(proposal);
    return NextResponse.json(
      {
        handoff: {
          ...handoff,
          commerce: {
            ...handoff.commerce,
            url: commerceApiUrl(handoff.commerce.path),
          },
        },
      },
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
        { error: "commerce_handoff_unavailable" },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }
}
