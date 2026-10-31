import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { getD1PostPageDataForViewer } from "@/lib/server/post-page-data";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント向けの投稿詳細。投稿・祖先・返信をまとめて返す。
 * Webの投稿ページと同じローダーに載せるので、ブロック・ミュート・
 * 削除済みの扱いは画面側と同じ。未接続でも公開投稿は読める。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  const { postId } = await params;
  if (typeof postId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(postId)) {
    return NextResponse.json({ error: "投稿の指定が正しくありません。" }, { status: 400 });
  }
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  try {
    const viewer = await getOptionalHubViewerProfile(request, database);
    const data = await getD1PostPageDataForViewer(database, viewer, postId, "recommended");
    if (!data.post) {
      return NextResponse.json({ error: "投稿が見つかりません。" }, { status: 404 });
    }
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    throw error;
  }
}
