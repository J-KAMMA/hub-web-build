import { NextResponse } from "next/server";

import {
  setThreadNotificationModeRouteData,
  toggleThreadFollowingRouteData,
} from "@/lib/server/thread-actions-route-data";
import { DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError } from "@/lib/server/hub-session";

function authError(error: unknown) {
  return (
    error instanceof HubAuthenticationError ||
    error instanceof DesktopHubAuthenticationError
  );
}

/**
 * クライアント向けのスレッド追跡・通知頻度。ブラウザ側は
 * /api/bbs/threads/[id]/follow が同一オリジン前提なので別口にする。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  try {
    return NextResponse.json(await toggleThreadFollowingRouteData(request, threadId));
  } catch (error) {
    if (authError(error)) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 404 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
  if (!body || !["instant", "digest", "important", "none"].includes(String(body.mode))) {
    return NextResponse.json({ error: "通知頻度が正しくありません。" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await setThreadNotificationModeRouteData(
        request,
        threadId,
        body.mode as "instant" | "digest" | "important" | "none",
      ),
    );
  } catch (error) {
    if (authError(error)) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新できませんでした。" },
      { status: 400 },
    );
  }
}
