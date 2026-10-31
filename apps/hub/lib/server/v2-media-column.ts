import { loadRegisteredNav } from "@/lib/server/v2-nav-registered";
import type { RegisteredNavItem } from "@/lib/v2-feed-nav";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getClientSidebarPage, type SidebarKind, type SidebarPage } from "@/lib/server/client-sidebar";

/**
 * Web v2 の内側の列に渡す最初の1頁（フォロー中のタグと登録チャンネル）。
 * デスクトップの /api/client/sidebar と同じ関数をサーバーコンポーネントから直接呼ぶ。
 * 続きの頁はブラウザが同じ API をセッション Cookie で読む。
 * 未ログイン・D1 なしなら null（列は登録チャンネルとマイページの節を出さない）。
 */
export type V2MediaColumnData = {
  initial: Pick<SidebarPage, "channels" | "nextCursor"> | null;
  followedTags: string[];
};

export async function loadV2MediaColumn(viewerId: string | null | undefined, kind: SidebarKind): Promise<V2MediaColumnData> {
  if (!viewerId) return { initial: null, followedTags: [] };
  const database = getOptionalHubD1();
  if (!database) return { initial: null, followedTags: [] };
  try {
    const page = await getClientSidebarPage(database, viewerId, kind);
    return { initial: { channels: page.channels, nextCursor: page.nextCursor }, followedTags: page.followedTags ?? [] };
  } catch {
    return { initial: { channels: [], nextCursor: null }, followedTags: [] };
  }
}

/**
 * タイムラインの内側の列の「登録」（本人のリスト・追跡中のスレッド・参加中のコミュニティ。並びは本人の保存順）。
 * 未ログイン・D1 なしは null、読めなければ空（列は「リストを作る」を出す）。
 */
export async function loadV2FeedLists(viewerId: string | null | undefined): Promise<RegisteredNavItem[] | null> {
  if (!viewerId) return null;
  const database = getOptionalHubD1();
  if (!database) return null;
  try {
    return await loadRegisteredNav(database, viewerId);
  } catch {
    return [];
  }
}
