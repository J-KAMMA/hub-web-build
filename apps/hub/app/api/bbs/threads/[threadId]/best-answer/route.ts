import { NextResponse } from "next/server";

import { setThreadBestAnswerRouteData } from "@/lib/server/thread-actions-route-data";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { threadId } = await params;
  const body = await request.json().catch(() => null) as { post_id?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (body.post_id !== null && typeof body.post_id !== "string") {
    return NextResponse.json({ error: "Invalid post id." }, { status: 400 });
  }
  try {
    return NextResponse.json(await setThreadBestAnswerRouteData(request, threadId, body.post_id));
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: message.startsWith("Only") ? 403 : 400 });
  }
}
