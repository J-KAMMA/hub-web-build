import { NextResponse } from "next/server";

import { ensureD1ThreadAvailable } from "@/lib/server/bbs-route-data";
import { requireHubSessionProfile, HubAuthenticationError } from "@/lib/server/hub-session";
import { setD1ThreadSlowMode } from "@/lib/server/d1-threads";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { threadId } = await params;
  const body = await request.json().catch(() => null) as { seconds?: unknown } | null;
  if (!body || typeof body.seconds !== "number") {
    return NextResponse.json({ error: "スローモードの設定値が正しくありません。" }, { status: 400 });
  }
  try {
    const database = await ensureD1ThreadAvailable(threadId);
    if (!database) throw new HubAuthenticationError();
    const viewer = await requireHubSessionProfile(request, database);
    const thread = await setD1ThreadSlowMode(database, threadId, viewer.id, body.seconds);
    return NextResponse.json({ thread });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: message.startsWith("Only") ? 403 : 400 });
  }
}
