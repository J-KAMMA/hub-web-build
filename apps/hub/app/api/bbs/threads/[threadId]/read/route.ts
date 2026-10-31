import { NextResponse } from "next/server";

import { markThreadReadRouteData } from "@/lib/server/thread-actions-route-data";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { threadId } = await params;
  const body = await request.json().catch(() => null) as { last_read_post_no?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (typeof body.last_read_post_no !== "number" || !Number.isInteger(body.last_read_post_no) || body.last_read_post_no < 0) {
    return NextResponse.json({ error: "Invalid last read post number." }, { status: 400 });
  }
  try {
    return NextResponse.json(await markThreadReadRouteData(request, threadId, body.last_read_post_no));
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected error." }, { status: 404 });
  }
}
