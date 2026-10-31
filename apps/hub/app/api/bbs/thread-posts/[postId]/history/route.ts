import { NextResponse } from "next/server";

import { getThreadPostHistoryRouteData } from "@/lib/server/thread-post-actions-route-data";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  try {
    return NextResponse.json(await getThreadPostHistoryRouteData(request, postId), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "履歴を見るにはHubへログインしてください。" }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "履歴を利用できません。" }, { status: 503, headers: PRIVATE_HEADERS });
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: message.startsWith("You can") ? 403 : 404, headers: PRIVATE_HEADERS });
  }
}
