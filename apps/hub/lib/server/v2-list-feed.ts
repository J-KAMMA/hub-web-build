import type { D1Database } from "@cloudflare/workers-types";

import { listD1UserListFeed, type D1UserListFeedItem } from "@/lib/server/d1-user-list-feed";
import { encodeTimelineCursor } from "@/lib/timeline-cursor";

/*
 * ?feed=list&list=<id> の1頁目。アクセス規則は GET /api/lists/[listId]/feed と同じ（持ち主だけ）。
 * 名前の確認は id と名前の1行だけで、本文は読まない。投稿の本文は listD1UserListFeed が redactGated を通す。
 * 無い・他人の・読めないリストは例外にせず missing を返す（画面は短い案内を出す）。
 */
export const V2_LIST_FEED_PAGE = 20;

export type V2ListFeedResult =
  | { status: "ok"; name: string; items: D1UserListFeedItem[]; nextCursor: string | null }
  | { status: "missing" };

export async function loadV2ListFeed(
  database: D1Database | null,
  viewerId: string | null | undefined,
  listId: string | null | undefined,
): Promise<V2ListFeedResult> {
  if (!database || !viewerId || !listId || listId.length > 128) return { status: "missing" };
  try {
    const list = await database.prepare("SELECT name FROM user_lists WHERE id = ? AND owner_profile_id = ?")
      .bind(listId, viewerId).first<{ name: string }>();
    if (!list) return { status: "missing" };
    const items = await listD1UserListFeed(database, viewerId, listId, V2_LIST_FEED_PAGE);
    const last = items.at(-1);
    const lastKey = last ? `${last.kind === "social" ? "social" : "thread"}_${last.kind === "social" ? last.post.id : last.response.id}` : null;
    return {
      status: "ok",
      name: list.name,
      items,
      nextCursor: items.length === V2_LIST_FEED_PAGE && last && lastKey ? encodeTimelineCursor({ createdAt: last.createdAt, id: lastKey }) : null,
    };
  } catch {
    return { status: "missing" };
  }
}
