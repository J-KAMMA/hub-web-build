import { NextResponse } from "next/server";

import { parseSocialPostAnalyticsPayload } from "@/lib/post-analytics";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { recordSocialPostAnalyticsEvent } from "@/lib/server/d1-post-analytics";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const payload = parseSocialPostAnalyticsPayload(await request.json().catch(() => null));
  if (!payload) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  const database = getHubD1();
  const viewer = await getOptionalHubSessionProfile(request, database);
  const recorded = await recordSocialPostAnalyticsEvent(database, payload, viewer?.id ?? null);
  return NextResponse.json({ recorded }, {
    headers: { "Cache-Control": "no-store" },
  });
}

