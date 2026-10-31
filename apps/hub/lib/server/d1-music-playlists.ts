import type { D1Database } from "@cloudflare/workers-types";
import { MUSIC_WORKS } from "@/lib/music-catalog";

type PlaylistRow = { id: string; title: string; description: string; created_at: string; updated_at: string };
type PlaylistItemRow = { playlist_id: string; music_work_id: string };

export interface MusicPlaylistRecord {
  id: string;
  title: string;
  description: string;
  workIds: string[];
  createdAt: string;
  updatedAt: string;
}

export class InvalidMusicPlaylistError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidMusicPlaylistError"; }
}

export function isPublicMusicTrackPlaylistKey(value: string): boolean {
  return /^music:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function text(value: unknown, field: string, max: number, required: boolean): string {
  if (typeof value !== "string") throw new InvalidMusicPlaylistError(`${field}を入力してください。`);
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if ((required && !normalized) || normalized.length > max || /\p{Cc}/u.test(normalized)) throw new InvalidMusicPlaylistError(`${field}が正しくありません。`);
  return normalized;
}

export function parseMusicPlaylistInput(input: unknown): { title: string; description: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InvalidMusicPlaylistError("入力内容が正しくありません。");
  const record = input as Record<string, unknown>;
  return { title: text(record.title, "プレイリスト名", 80, true), description: text(record.description ?? "", "説明", 500, false) };
}

export function parseMusicPlaylistItems(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InvalidMusicPlaylistError("入力内容が正しくありません。");
  const workIds = Reflect.get(input, "workIds");
  if (!Array.isArray(workIds) || workIds.length > 200) throw new InvalidMusicPlaylistError("曲は200件以内で指定してください。");
  const normalized = workIds.map((id) => text(id, "作品ID", 128, true));
  if (new Set(normalized).size !== normalized.length) throw new InvalidMusicPlaylistError("同じ曲を重複して追加できません。");
  return normalized;
}

export async function listD1MusicPlaylists(database: D1Database, profileId: string): Promise<MusicPlaylistRecord[]> {
  const playlists = await database.prepare(`SELECT id, title, description, created_at, updated_at FROM music_playlists
    WHERE owner_profile_id = ? ORDER BY updated_at DESC LIMIT 100`).bind(profileId).all<PlaylistRow>();
  if (!playlists.results.length) return [];
  const items = await database.prepare(`SELECT i.playlist_id, i.music_work_id FROM music_playlist_items i
    JOIN music_playlists p ON p.id = i.playlist_id
    WHERE p.owner_profile_id = ? ORDER BY i.playlist_id, i.position, i.created_at`).bind(profileId).all<PlaylistItemRow>();
  const byPlaylist = new Map<string, string[]>();
  for (const item of items.results) {
    const ids = byPlaylist.get(item.playlist_id) ?? [];
    ids.push(item.music_work_id);
    byPlaylist.set(item.playlist_id, ids);
  }
  return playlists.results.map((row) => ({ id: row.id, title: row.title, description: row.description,
    workIds: byPlaylist.get(row.id) ?? [], createdAt: row.created_at, updatedAt: row.updated_at }));
}

export async function createD1MusicPlaylist(database: D1Database, profileId: string, input: { title: string; description: string }, now = new Date()): Promise<MusicPlaylistRecord> {
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  await database.prepare(`INSERT INTO music_playlists (id, owner_profile_id, title, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(id, profileId, input.title, input.description, timestamp, timestamp).run();
  return { id, ...input, workIds: [], createdAt: timestamp, updatedAt: timestamp };
}

export async function updateD1MusicPlaylist(database: D1Database, profileId: string, playlistId: string, input: { title: string; description: string }, now = new Date()): Promise<boolean> {
  const result = await database.prepare(`UPDATE music_playlists SET title = ?, description = ?, updated_at = ?
    WHERE id = ? AND owner_profile_id = ?`).bind(input.title, input.description, now.toISOString(), playlistId, profileId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function deleteD1MusicPlaylist(database: D1Database, profileId: string, playlistId: string): Promise<boolean> {
  const result = await database.prepare("DELETE FROM music_playlists WHERE id = ? AND owner_profile_id = ?").bind(playlistId, profileId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function assertAvailableMusicItemIds(database: D1Database, workIds: string[]): Promise<void> {
  if (workIds.length) {
    const catalogIds = workIds.filter((id) => !isPublicMusicTrackPlaylistKey(id));
    const available = new Set(MUSIC_WORKS.map((work) => work.id));
    for (let offset = 0; offset < catalogIds.length; offset += 60) {
      const batch = catalogIds.slice(offset, offset + 60);
      const rows = await database.prepare(`SELECT id FROM music_works WHERE status = 'active' AND id IN (${batch.map(() => "?").join(",")})`).bind(...batch).all<{ id: string }>();
      for (const row of rows.results) available.add(row.id);
    }
    if (workIds.some((id) => !isPublicMusicTrackPlaylistKey(id) && !available.has(id))) throw new InvalidMusicPlaylistError("存在しない作品が含まれています。");
  }
}

export async function replaceD1MusicPlaylistItems(database: D1Database, profileId: string, playlistId: string, workIds: string[], now = new Date()): Promise<boolean> {
  const owner = await database.prepare("SELECT id FROM music_playlists WHERE id = ? AND owner_profile_id = ? LIMIT 1").bind(playlistId, profileId).first<{ id: string }>();
  if (!owner) return false;
  await assertAvailableMusicItemIds(database, workIds);
  const timestamp = now.toISOString();
  const statements = [database.prepare("DELETE FROM music_playlist_items WHERE playlist_id = ?").bind(playlistId)];
  workIds.forEach((workId, position) => statements.push(database.prepare(`INSERT INTO music_playlist_items
    (playlist_id, music_work_id, position, created_at) VALUES (?, ?, ?, ?)`).bind(playlistId, workId, position, timestamp)));
  statements.push(database.prepare("UPDATE music_playlists SET updated_at = ? WHERE id = ? AND owner_profile_id = ?").bind(timestamp, playlistId, profileId));
  await database.batch(statements);
  return true;
}
