import type { D1Database } from "@cloudflare/workers-types";

import { assertAvailableMusicItemIds } from "@/lib/server/d1-music-playlists";

type FavoriteRow = { music_item_id: string };

export async function listD1MusicFavoriteIds(database: D1Database, profileId: string): Promise<string[]> {
  const result = await database.prepare(`SELECT music_item_id FROM music_favorites
    WHERE owner_profile_id = ? ORDER BY created_at DESC`).bind(profileId).all<FavoriteRow>();
  return result.results.map((row) => row.music_item_id);
}

export async function replaceD1MusicFavorites(
  database: D1Database,
  profileId: string,
  itemIds: string[],
  now = new Date(),
): Promise<void> {
  await assertAvailableMusicItemIds(database, itemIds);
  const timestamp = now.toISOString();
  const statements = [database.prepare("DELETE FROM music_favorites WHERE owner_profile_id = ?").bind(profileId)];
  itemIds.forEach((itemId, index) => statements.push(database.prepare(`INSERT INTO music_favorites
    (owner_profile_id, music_item_id, created_at) VALUES (?, ?, ?)`)
    .bind(profileId, itemId, new Date(now.getTime() + index).toISOString())));
  await database.batch(statements);
}
