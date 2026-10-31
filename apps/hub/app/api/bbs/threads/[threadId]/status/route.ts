import { NextResponse } from "next/server";
import { ensureD1ThreadAvailable } from "@/lib/server/bbs-route-data";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { setD1ThreadStatus } from "@/lib/server/d1-threads";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { threadId } = await params;
  const body = await request.json().catch(() => null) as { status?: unknown } | null;
  if (!body || !["open", "closed", "archived"].includes(String(body.status))) return NextResponse.json({ error: "状態が正しくありません。" }, { status: 400 });
  try {
    const database = await ensureD1ThreadAvailable(threadId);
    if (!database) throw new HubAuthenticationError();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json({ thread: await setD1ThreadStatus(database, threadId, viewer.id, body.status as "open" | "closed" | "archived") });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新できませんでした。" }, { status: 403 });
  }
}
