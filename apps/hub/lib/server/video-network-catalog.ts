import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {youtubeIdFromServiceUrl} from './music-network-catalog';
import {publicVideoOriginSql} from './video-public-origin';

/*
 * Public, anonymous video listing for hub.catalog.v1 kind "video".
 * References only: this Hub's active external videos. Only YouTube items carry a
 * youtubeId; no audio/video bytes, file paths or other URLs are ever emitted.
 */
export const VIDEO_NETWORK_MAX_ITEMS = 100;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export type VideoNetworkMedia = {origin?: 'hub'; youtubeId?: string; channel?: string; duration?: string};
export type VideoNetworkItem = {id: string; title: string; summary: string; path: string; updatedAt: string; media?: VideoNetworkMedia};

type Row = {id: string; title: string; channel: string | null; topic: string | null; provider: string; source_url: string | null; duration: string | null; published_at: string | null; created_at: string | null};

export async function videoNetworkItems(db: D1Database): Promise<VideoNetworkItem[]> {
  const rows = await db.prepare(`SELECT v.id, v.title, v.channel, v.topic, v.provider, v.source_url, v.duration, v.published_at, v.created_at
    FROM external_videos v
    WHERE v.status = 'active' AND COALESCE(v.availability_status, 'unknown') != 'unavailable'
      AND ${publicVideoOriginSql('v')}
    ORDER BY v.published_at DESC, v.created_at DESC, v.id DESC
    LIMIT ?`).bind(VIDEO_NETWORK_MAX_ITEMS * 2).all<Row>();
  const seen = new Set<string>(), items: VideoNetworkItem[] = [];
  for (const row of rows.results) {
    if (items.length >= VIDEO_NETWORK_MAX_ITEMS) break;
    if (typeof row.id !== 'string' || !ID.test(row.id) || seen.has(row.id) || typeof row.title !== 'string' || !row.title) continue;
    seen.add(row.id);
    const youtubeId = row.provider === 'youtube' ? youtubeIdFromServiceUrl(row.source_url) : null;
    const channel = typeof row.channel === 'string' ? row.channel.slice(0, 160) : '';
    const duration = typeof row.duration === 'string' ? row.duration.slice(0, 16) : '';
    const media: VideoNetworkMedia = {...(row.provider === 'hub' ? {origin: 'hub' as const} : {}), ...(youtubeId ? {youtubeId} : {}), ...(channel ? {channel} : {}), ...(duration ? {duration} : {})};
    items.push({id: row.id, title: row.title.slice(0, 240), summary: typeof row.topic === 'string' ? row.topic.slice(0, 5000) : '',
      path: `/v2/videos/${row.id}`, updatedAt: String(row.published_at || row.created_at || '').slice(0, 40),
      ...(Object.keys(media).length ? {media} : {})});
  }
  return items;
}
