import { NextResponse } from "next/server";

import { setThreadBestAnswerRouteData } from "@/lib/server/thread-actions-route-data";
import { DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError } from "@/lib/server/hub-session";

/**
 * クライアント向けのベストアンサー指定。ブラウザ側は
 * /api/bbs/threads/[id]/best-answer が同一オリジン前提なので別口にする。
 * スレッド所有者の判定は共通の route-data に集約されている。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const body = (await request.json().catch(() => null)) as {
    post_id?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (body.post_id !== null && typeof body.post_id !== "string") {
    return NextResponse.json({ error: "Invalid post id." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await setThreadBestAnswerRouteData(request, threadId, body.post_id),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof HubAuthenticationError ||
      error instanceof DesktopHubAuthenticationError
    ) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("Only") ? 403 : 400 },
    );
  }
}
