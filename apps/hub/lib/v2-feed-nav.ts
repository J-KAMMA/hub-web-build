import type { V2MediaRow } from "@/components/v2/v2-media-column";

/*
 * タイムラインの内側の列の木（所有者の設計、2026-10-27）。各種類の行を、その種類の上の段の直下に出す。
 * ホームの下: 本人のリスト（無ければ「リストを作る」）。コミュニティの下: 参加中（画像があれば出す）。
 * おすすめ・フォロー中・人気は列ではなく本文の上のタブ（X と同じ、components/v2/v2-feed-tabs.tsx）。
 * スレッドは子の行を持たない（上の段を押すとスレッド一覧が開く、2026-10-27）。並べ替えるのはリストとコミュニティだけ。
 * 並びは本人が並べた順（無いものは登録の新しい順で後ろ）。全部出し、上限は無い。未ログインは子の行なし。
 */
export const NAV_ITEM_LIMIT = 200;
export const NAV_ORDER_MAX = 200;
const LISTS_HREF = "/v2/lists?tab=community";

export type FeedNavActive = "recommended" | "following" | "popular" | "list" | null;


export type NavItemType = "list" | "thread" | "community";
/* imageUrl はコミュニティの公開画像（communities.image_url）。リスト・フィードはアイコンのまま。 */
export type RegisteredNavItem = { type: NavItemType; id: string; name: string; at: string; imageUrl?: string | null };

/* 保存した位置の順 → 位置の無い行は登録の新しい順（同時刻は種類と id で固定）。消えた行は元の表に無いので出てこない。 */
export function orderNavItems(items: RegisteredNavItem[], positions: Map<string, number>): RegisteredNavItem[] {
  const key = (item: RegisteredNavItem) => `${item.type}:${item.id}`;
  const stored = items.filter((item) => positions.has(key(item))).sort((a, b) => positions.get(key(a))! - positions.get(key(b))! || key(a).localeCompare(key(b)));
  const rest = items.filter((item) => !positions.has(key(item))).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : key(a).localeCompare(key(b))));
  return [...stored, ...rest];
}

export function navItemHref(type: NavItemType, id: string): string {
  const encoded = encodeURIComponent(id);
  return type === "list" ? `/v2?feed=list&list=${encoded}` : type === "thread" ? `/v2/threads/${encoded}` : `/v2/community?community=${encoded}`;
}

const NAV_ICON = { list: "list", thread: "threads", community: "people" } as const;

/* 上の段の種類ごとの子の行。キーは上の段の key（投稿のホーム = post）。 */
export type FeedNavTree = { post: V2MediaRow[]; community: V2MediaRow[] };

export function buildFeedNavTree(input: {
  japanese: boolean;
  active: FeedNavActive;
  activeListId?: string | null;
  /* null は未ログイン（リスト・コミュニティの子を出さない）。 */
  registered: RegisteredNavItem[] | null;
}): FeedNavTree {
  const t = (ja: string, en: string) => (input.japanese ? ja : en);
  const post: V2MediaRow[] = [];
  const tree: FeedNavTree = { post, community: [] };
  if (!input.registered) return tree;
  const rowsOf = (type: "list" | "community"): V2MediaRow[] => input.registered!.filter((item) => item.type === type).map((item) => ({
    key: `${item.type}:${item.id}`,
    label: item.name,
    icon: NAV_ICON[item.type],
    ...(item.imageUrl && (item.imageUrl.startsWith("https://") || item.imageUrl.startsWith("/")) ? { imageUrl: item.imageUrl } : {}),
    href: navItemHref(item.type, item.id),
    selected: item.type === "list" && input.active === "list" && input.activeListId === item.id,
    nav: { type, id: item.id },
  }));
  const lists = rowsOf("list");
  post.push(...(lists.length ? lists : [{ key: "lists-create", label: t("リストを作る", "Create a list"), icon: "plus" as const, href: LISTS_HREF }]));
  tree.community = rowsOf("community");
  return tree;
}
