import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { getAtprotoFeed } from "@/lib/server/federation-gateway";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const profile = await requireHubSessionProfile(request, getHubD1());
    const cursor = new URL(request.url).searchParams.get("cursor");
    const feed = await getAtprotoFeed(profile.id, cursor);
    return feed
      ? NextResponse.json(feed, { headers })
      : NextResponse.json(
          { error: "atproto_feed_unavailable" },
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

