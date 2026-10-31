import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { markD1ThreadRead } from "@/lib/server/d1-threads";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const body = await request.json().catch(() => null);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(threadId) || !body || Array.isArray(body) || !Number.isSafeInteger(body.last_read_post_no) || body.last_read_post_no < 0) {
    return NextResponse.json({ error: "既読位置が正しくありません。" }, { status: 400, headers });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    // Shared persistence clamps to postCount and never decreases a saved position.
    return NextResponse.json({ tracking: await markD1ThreadRead(database, threadId, viewer.id, body.last_read_post_no) }, { headers });
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401, headers });
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403, headers });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
    const missing = error instanceof Error && error.message === "Thread does not exist.";
    return NextResponse.json({ error: missing ? "スレッドが見つかりません。" : "スレッドの既読位置を更新できませんでした。" }, { status: missing ? 404 : 503, headers });
  }
}
