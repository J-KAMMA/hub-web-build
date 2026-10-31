import { musicWorkHref } from "@/lib/music-work-href";
import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import { isRedirectResponse } from "@/lib/redirect-guard";

/*
 * Public, anonymous music listing for hub.catalog.v1 kind "music".
 * Two sources, both already public: (a) this Hub's active external works that
 * have a YouTube link, (b) published+clean tracks read over the Music Worker's
 * public HTTP API. Hub never touches Music storage; Worker failure degrades to (a).
 */
export const MUSIC_NETWORK_MAX_ITEMS = 100;
const WORK_LIMIT = 60, TRACK_LIMIT = 50, MAX_BODY = 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type MusicNetworkMedia = {youtubeId?: string; audioPath?: string; artist?: string; artworkPath?: string};
export type MusicNetworkItem = {id: string; title: string; summary: string; path: string; updatedAt: string; media?: MusicNetworkMedia};

/** Accepts only the two URL shapes Hub itself stores for a YouTube service link. */
export function youtubeIdFromServiceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'www.youtube-nocookie.com') {
    const m = /^\/embed\/([A-Za-z0-9_-]{11})$/.exec(url.pathname);
    id = m ? m[1] : null;
  } else if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : null;
  } else if (host === 'youtu.be') {
    id = url.pathname.slice(1);
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

type WorkRow = {id: string; title: string; artist: string; description: string; created_at: string; source_url: string | null; embed_url: string | null};

export async function externalMusicWorkItems(db: D1Database, limit = WORK_LIMIT): Promise<MusicNetworkItem[]> {
  const bounded = Math.max(1, Math.min(WORK_LIMIT, Math.trunc(limit)));
  const rows = await db.prepare(`SELECT w.id, w.title, w.artist, w.description, w.created_at, l.source_url, l.embed_url
    FROM music_works w
    JOIN music_service_links l ON l.music_work_id = w.id AND l.provider = 'youtube' AND l.availability_status != 'unavailable'
    WHERE w.status = 'active'
    ORDER BY w.created_at DESC, w.id DESC
    LIMIT ?`).bind(bounded * 2).all<WorkRow>();
  const seen = new Set<string>(), items: MusicNetworkItem[] = [];
  for (const row of rows.results) {
    if (items.length >= bounded) break;
    if (typeof row.id !== 'string' || !ID.test(row.id) || seen.has(row.id) || typeof row.title !== 'string' || !row.title) continue;
    const youtubeId = youtubeIdFromServiceUrl(row.embed_url) ?? youtubeIdFromServiceUrl(row.source_url);
    if (!youtubeId) continue;
    seen.add(row.id);
    const artist = typeof row.artist === 'string' ? row.artist.slice(0, 160) : '';
    items.push({id: row.id, title: row.title.slice(0, 240), summary: typeof row.description === 'string' ? row.description.slice(0, 5000) : '',
      path: musicWorkHref(String(row.id)), updatedAt: String(row.created_at ?? '').slice(0, 40),
      media: {youtubeId, ...(artist ? {artist} : {})}});
  }
  return items;
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw Error('music_unavailable');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > MAX_BODY) { await reader.cancel(); throw Error('music_unavailable'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Published+clean tracks only: the Worker's public list enforces that; shape is re-validated here. */
export async function workerMusicTrackItems(origin: string, limit = TRACK_LIMIT, fetcher: typeof fetch = fetch): Promise<MusicNetworkItem[]> {
  const bounded = Math.max(1, Math.min(TRACK_LIMIT, Math.trunc(limit)));
  const url = new URL('/music/api/tracks', origin);
  url.searchParams.set('limit', String(bounded));
  const response = await fetcher(url, {cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(6_000), headers: {accept: 'application/json'}});
  if (!response.ok || isRedirectResponse(response)) throw Error('music_unavailable');
  const body = await boundedJson(response) as {tracks?: unknown};
  if (!body || !Array.isArray(body.tracks)) throw Error('music_unavailable');
  const seen = new Set<string>(), items: MusicNetworkItem[] = [];
  for (const track of body.tracks.slice(0, bounded) as Record<string, unknown>[]) {
    if (!track || typeof track.id !== 'string' || !UUID.test(track.id) || seen.has(track.id) || typeof track.title !== 'string' || !track.title
      || typeof track.publishedAt !== 'string' || !Number.isFinite(Date.parse(track.publishedAt))) continue;
    seen.add(track.id);
    const artist = typeof track.artist === 'string' ? track.artist.slice(0, 160) : '';
    items.push({id: track.id, title: track.title.slice(0, 240), summary: typeof track.description === 'string' ? track.description.slice(0, 5000) : '',
      path: musicWorkHref(`music:${track.id}`), updatedAt: track.publishedAt.slice(0, 40),
      media: {audioPath: `/music/api/tracks/${track.id}/audio`, ...(artist ? {artist} : {}),
        ...(track.artworkUrl === `/music/api/tracks/${track.id}/artwork` ? {artworkPath: track.artworkUrl as string} : {})}});
  }
  return items;
}

export async function musicNetworkItems(db: D1Database, musicOrigin: string | null, fetcher: typeof fetch = fetch): Promise<MusicNetworkItem[]> {
  const [works, tracks] = await Promise.all([
    externalMusicWorkItems(db),
    musicOrigin ? workerMusicTrackItems(musicOrigin, TRACK_LIMIT, fetcher).catch(() => [] as MusicNetworkItem[]) : Promise.resolve([] as MusicNetworkItem[]),
  ]);
  const seen = new Set<string>();
  return [...works, ...tracks].filter(item => !seen.has(item.id) && !!seen.add(item.id))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || 0)
    .slice(0, MUSIC_NETWORK_MAX_ITEMS);
}
