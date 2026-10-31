import 'server-only';
import type { D1Database } from '@cloudflare/workers-types';
import type { MusicWork } from '@/lib/music-catalog';
import { readMusicWorksByIds } from './client-music-library';

/*
 * 似ている曲（docs/hub-music-similar/PLAN.md）。Music Worker の公開版付き API から曲 ID の並びだけを受け取り、
 * 表示する曲情報は既存の公開曲 API（readMusicWorksByIds）で引き直す。そこでも公開・clean・非表示でない曲だけが残る。
 * ベクトル、制作者の識別子、Music の秘密は Hub に来ない。失敗したら帯ごと出さない（null）。
 */

export type MusicSimilarReason = 'similar' | 'same_album' | 'same_artist' | 'nearby';
export type MusicSimilarResult = { basis: 'embedding' | 'fallback'; items: { work: MusicWork; reason: MusicSimilarReason }[] };

const WORK_ID = /^music:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ITEMS = 8;
const MAX_RESPONSE_BYTES = 64 * 1024;
const FALLBACK_REASONS = new Set(['same_album', 'same_artist', 'nearby']);

export function parseMusicSimilarResponse(value: unknown, trackId: string): { basis: 'embedding' | 'fallback'; items: { id: string; reason: MusicSimilarReason }[] } | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as { trackId?: unknown; basis?: unknown; items?: unknown };
  if (body.trackId !== trackId || (body.basis !== 'embedding' && body.basis !== 'fallback') || !Array.isArray(body.items) || body.items.length > 20) return null;
  const seen = new Set<string>([trackId]);
  const items: { id: string; reason: MusicSimilarReason }[] = [];
  for (const item of body.items as unknown[]) {
    if (!item || typeof item !== 'object') return null;
    const { id, reason } = item as { id?: unknown; reason?: unknown };
    if (typeof id !== 'string' || !UUID.test(id) || seen.has(id)) return null;
    if (body.basis === 'embedding' ? reason !== 'similar' : typeof reason !== 'string' || !FALLBACK_REASONS.has(reason)) return null;
    seen.add(id);
    items.push({ id, reason: reason as MusicSimilarReason });
  }
  return { basis: body.basis, items: items.slice(0, MAX_ITEMS) };
}

export async function readSimilarMusicWorks(db: D1Database, origin: string, workId: string): Promise<MusicSimilarResult | null> {
  const match = WORK_ID.exec(workId);
  if (!match) return null;
  const trackId = match[1].toLowerCase();
  try {
    const url = new URL(`/music/api/v1/tracks/${trackId}/similar`, origin);
    url.searchParams.set('limit', String(MAX_ITEMS));
    const response = await fetch(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(5_000), headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return null;
    const parsed = parseMusicSimilarResponse(JSON.parse(text), trackId);
    if (!parsed || parsed.items.length === 0) return null;
    const works = await readMusicWorksByIds(db, parsed.items.map(item => `music:${item.id}`), origin);
    const byId = new Map(works.map(work => [work.id.toLowerCase(), work]));
    const items = parsed.items.flatMap(item => {
      const work = byId.get(`music:${item.id}`);
      return work ? [{ work, reason: item.reason }] : [];
    });
    return items.length ? { basis: parsed.basis, items } : null;
  } catch {
    return null;
  }
}
