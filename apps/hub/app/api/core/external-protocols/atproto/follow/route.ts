import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { followAtprotoActor } from "@/lib/server/federation-gateway";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 403, headers },
    );
  }
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const body = await request.json().catch(() => null) as {
      actor?: unknown;
    } | null;
    const actor = typeof body?.actor === "string"
      ? body.actor.trim().slice(0, 253)
      : "";
    if (!actor || !/^(?:did:[a-z0-9]+:[A-Za-z0-9._:%-]+|[A-Za-z0-9._-]+\.[A-Za-z0-9.-]+)$/.test(actor)) {
      return NextResponse.json(
        { error: "invalid_atproto_actor" },
        { status: 400, headers },
      );
    }
    const followed = await followAtprotoActor(profile.id, actor);
    return followed
      ? NextResponse.json({ followed }, { status: 201, headers })
      : NextResponse.json(
          { error: "atproto_follow_unavailable" },
          { status: 503, headers },
        );
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json(
        { error: "authentication_required" },
        { status: 401, headers },
      );
    }
    throw error;
  }
}

