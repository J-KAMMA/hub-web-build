import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { setD1ThreadStatus } from "@/lib/server/d1-threads";

const headers = { "cache-control": "private, no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const body = await request.json().catch(() => null);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(threadId) || !body || Array.isArray(body) || !["open", "closed"].includes(body.status)) {
    return NextResponse.json({ error: "受付状態が正しくありません。" }, { status: 400, headers });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    return NextResponse.json({ thread: await setD1ThreadStatus(database, threadId, viewer.id, body.status) }, { headers });
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401, headers });
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403, headers });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
    const message = error instanceof Error ? error.message : "";
    if (message === "Thread does not exist.") return NextResponse.json({ error: "スレッドが見つかりません。" }, { status: 404, headers });
    if (message === "スレッド作成者だけが状態を変更できます。") return NextResponse.json({ error: "スレッド作成者だけが受付状態を変更できます。" }, { status: 403, headers });
    return NextResponse.json({ error: "スレッドの受付状態を変更できませんでした。" }, { status: 503, headers });
  }
}
