import type { D1Database } from "@cloudflare/workers-types";

import { NAV_ITEM_LIMIT, orderNavItems, type NavItemType, type RegisteredNavItem } from "@/lib/v2-feed-nav";

/*
 * 「登録」の行（2026-10-27）。本人のリスト・参加中のコミュニティを、
 * 元の表から id と名前（コミュニティは公開画像の URL も）だけ読む。スレッドは出さない（読まない）。並びの表 hub_nav_order は順序だけで、行そのものは持たない。
 * 本文は読まない。元ごとに LIMIT をかけ、N+1 は無い（3 本の読み出し）。
 */
export type NavOrderEntry = { type: NavItemType; id: string };

/* "thread" は移行の CHECK と型検査では受け付ける（保存済みの行は無害で、画面では無視される）。 */
export function isNavItemType(value: unknown): value is NavItemType {
  return value === "list" || value === "thread" || value === "community";
}

async function readSources(database: D1Database, profileId: string): Promise<RegisteredNavItem[]> {
  const [lists, communities] = await Promise.all([
    database.prepare(`SELECT id, name, created_at AS at FROM user_lists
      WHERE owner_profile_id = ? ORDER BY created_at DESC, id LIMIT ?`)
      .bind(profileId, NAV_ITEM_LIMIT).all<{ id: string; name: string; at: string }>(),
    database.prepare(`SELECT c.id AS id, c.name AS name, c.image_url AS imageUrl, m.joined_at AS at FROM community_memberships m
      JOIN communities c ON c.id = m.community_id
      WHERE m.profile_id = ? AND m.status = 'active' ORDER BY m.joined_at DESC, c.id LIMIT ?`)
      .bind(profileId, NAV_ITEM_LIMIT).all<{ id: string; name: string; imageUrl: string | null; at: string }>(),
  ]);
  return [
    ...(lists.results ?? []).map((row) => ({ type: "list" as const, ...row })),
    ...(communities.results ?? []).map((row) => ({ type: "community" as const, ...row })),
  ];
}

/* 画面用: 保存した順 → 残りは登録の新しい順。壊れても例外にしない（呼び出し側が空で受ける）。 */
export async function loadRegisteredNav(database: D1Database, profileId: string): Promise<RegisteredNavItem[]> {
  const [items, order] = await Promise.all([
    readSources(database, profileId),
    database.prepare("SELECT item_type, item_id, position FROM hub_nav_order WHERE profile_id = ? LIMIT ?")
      .bind(profileId, NAV_ITEM_LIMIT * 3).all<{ item_type: string; item_id: string; position: number }>(),
  ]);
  const positions = new Map<string, number>();
  for (const row of order.results ?? []) positions.set(`${row.item_type}:${row.item_id}`, row.position);
  return orderNavItems(items, positions).slice(0, NAV_ITEM_LIMIT * 3);
}

/*
 * 並びの保存。いま本人が持っている行（本人のリスト・参加中のコミュニティ）だけを残し（thread は持たない扱いで捨てる）、他人の行や無い行は黙って捨てる。
 * 全置き換え（DELETE → INSERT）を 1 回の batch で行う。
 */
export async function saveNavOrder(database: D1Database, profileId: string, entries: NavOrderEntry[]): Promise<number> {
  const owned = new Set((await readSources(database, profileId)).map((item) => `${item.type}:${item.id}`));
  const seen = new Set<string>();
  const kept: NavOrderEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.type}:${entry.id}`;
    if (!owned.has(key) || seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  await database.batch([
    database.prepare("DELETE FROM hub_nav_order WHERE profile_id = ?").bind(profileId),
    ...kept.map((entry, position) =>
      database.prepare("INSERT INTO hub_nav_order(profile_id, item_type, item_id, position) VALUES(?, ?, ?, ?)")
        .bind(profileId, entry.type, entry.id, position)),
  ]);
  return kept.length;
}

/* 本人のデータの書き出し用。 */
export async function readOwnNavOrderExport(database: D1Database, profileId: string) {
  const result = await database
    .prepare("SELECT item_type, item_id, position FROM hub_nav_order WHERE profile_id = ? ORDER BY position, item_type, item_id LIMIT ?")
    .bind(profileId, NAV_ITEM_LIMIT * 3)
    .all<{ item_type: string; item_id: string; position: number }>();
  return result.results ?? [];
}
