import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { getThreadPageData } from "@/lib/server/thread-page-data";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * Webと同じ投稿・画像・知識情報・安全上の非表示判定を使う。
 * viewerはこのリクエストの認証結果だけを渡し、端末未接続時に
 * Web側の開発用viewerへフォールバックしない。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  if (typeof threadId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(threadId)) {
    return NextResponse.json({ error: "スレッドの指定が正しくありません。" }, { status: 400 });
  }
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  try {
    const viewer = await getOptionalHubViewerProfile(request, database);
    const page = await getThreadPageData(threadId, { viewer });
    if (!page.thread) return NextResponse.json({ error: "スレッドが見つかりません。" }, { status: 404 });
    const canManageStatus = Boolean(viewer && await database.prepare(
      "SELECT 1 AS allowed FROM threads WHERE id = ? AND created_by_profile_id = ?",
    ).bind(threadId, viewer.id).first());
    return NextResponse.json({
      thread: page.thread,
      posts: page.posts,
      workflowState: page.workflowState,
      relatedThreads: page.relatedThreads,
      viewer: viewer ? {
        id: viewer.id,
        following: Boolean(page.tracking?.following),
        lastReadPostNo: page.tracking?.lastReadPostNo ?? 0,
        canPickBestAnswer: page.thread.threadType === "question" && page.canManageThread,
        canManageStatus,
      } : null,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403 });
    throw error;
  }
}
