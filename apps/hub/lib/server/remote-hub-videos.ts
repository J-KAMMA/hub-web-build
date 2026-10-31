import type { D1Database } from "@cloudflare/workers-types";

import { ensureShadowProfile, isSuspendedProfile, type InboundEvent } from "@/lib/server/federation-inbound";

/*
 * Videos announced by other Hubs (PLAN 4.3). Catalog references only: this Hub stores the title,
 * duration, thumbnail URL and the remote watch-page URL, and never fetches, caches or proxies the
 * remote video bytes or HLS. Federation has already validated and followed-checked the activity;
 * these checks repeat the ones that protect Hub's own tables.
 */

const MEDIA_URL = /\.(m3u8|mpd|ts|m4s|mp4|webm|mkv|mov|key)(\?|#|$)|\/(hls|segments?|renditions?|tickets?)\//i;

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || MEDIA_URL.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

type Parsed = {
  objectId: string;
  title: string;
  summary: string;
  durationMs: number | null;
  watchUrl: string;
  thumbnailUrl: string | null;
  license: string;
  sensitive: number;
  publishedAt: string;
};

function parse(event: InboundEvent): Parsed | null {
  if (!event.actor) return null;
  const objectId = httpsUrl(event.objectId);
  const title = text(event.name, 240);
  const watchUrl = httpsUrl(event.watchUrl);
  // The entry is only a link to the remote watch page on the actor's own host.
  if (!objectId || !title || !watchUrl || !sameHost(watchUrl, event.actor.id) || !sameHost(objectId, event.actor.id)) return null;
  const rawThumb = event.thumbnailUrl;
  const thumbnailUrl = rawThumb === null || rawThumb === undefined ? null : httpsUrl(rawThumb);
  if (rawThumb !== null && rawThumb !== undefined && (!thumbnailUrl || !sameHost(thumbnailUrl, event.actor.id))) return null;
  const durationMs = typeof event.durationMs === "number" && Number.isFinite(event.durationMs) && event.durationMs >= 0
    ? Math.round(event.durationMs) : null;
  const published = typeof event.published === "string" ? Date.parse(event.published) : Number.NaN;
  return {
    objectId,
    title,
    summary: typeof event.summary === "string" ? event.summary.slice(0, 2000) : "",
    durationMs,
    watchUrl,
    thumbnailUrl,
    license: typeof event.license === "string" && /^[a-z0-9-]{1,16}$/.test(event.license) ? event.license : "arr",
    sensitive: event.sensitive === true ? 1 : 0,
    publishedAt: new Date(Number.isFinite(published) ? Math.min(published, Date.now()) : Date.now()).toISOString(),
  };
}

export async function applyRemoteVideo(database: D1Database, event: InboundEvent): Promise<void> {
  const video = parse(event);
  if (!video || !event.actor) return;
  // Only an actor one of this Hub's users follows (accepted) may add an entry; unfollowing stops new ones.
  const shadow = await ensureShadowProfile(database, event.actor);
  if (await isSuspendedProfile(database, shadow.profileId)) return;
  const followed = await database.prepare(
    "SELECT 1 AS yes FROM remote_follows WHERE remote_profile_id = ? AND state = 'accepted' LIMIT 1",
  ).bind(shadow.profileId).first();
  if (!followed) return;
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT OR IGNORE INTO remote_hub_videos
       (object_id, profile_id, actor_url, title, summary, duration_ms, watch_url, thumbnail_url, license, sensitive, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    video.objectId, shadow.profileId, event.actor.id, video.title, video.summary, video.durationMs, video.watchUrl,
    video.thumbnailUrl, video.license, video.sensitive, video.publishedAt, now, now,
  ).run();
}

export async function applyRemoteVideoUpdate(database: D1Database, event: InboundEvent): Promise<void> {
  const video = parse(event);
  if (!video || !event.actor) return;
  // Only the actor that created the entry can change it.
  await database.prepare(
    `UPDATE remote_hub_videos SET title = ?, summary = ?, duration_ms = ?, watch_url = ?, thumbnail_url = ?, license = ?, sensitive = ?, updated_at = ?
     WHERE object_id = ? AND actor_url = ? AND removed_at IS NULL`,
  ).bind(
    video.title, video.summary, video.durationMs, video.watchUrl, video.thumbnailUrl, video.license, video.sensitive,
    new Date().toISOString(), video.objectId, event.actor.id,
  ).run();
}

export async function applyRemoteVideoDelete(database: D1Database, event: InboundEvent): Promise<void> {
  const objectId = httpsUrl(event.objectId);
  if (!objectId || !event.actor) return;
  const now = new Date().toISOString();
  await database.prepare(
    "UPDATE remote_hub_videos SET removed_at = ?, updated_at = ? WHERE object_id = ? AND actor_url = ? AND removed_at IS NULL",
  ).bind(now, now, objectId, event.actor.id).run();
}

export type RemoteHubVideoEntry = {
  objectId: string;
  title: string;
  durationMs: number | null;
  watchUrl: string;
  thumbnailUrl: string | null;
  license: string;
  sensitive: boolean;
  publishedAt: string;
  channelHandle: string;
  channelName: string;
};

/**
 * Public listing of other Hubs' videos for the catalog. Entries from a suspended remote profile or
 * domain are left out; everything shown links to the remote watch page, never to remote media.
 */
export async function listRemoteHubVideos(database: D1Database, limit = 30): Promise<RemoteHubVideoEntry[]> {
  const rows = await database.prepare(
    `SELECT v.object_id, v.title, v.duration_ms, v.watch_url, v.thumbnail_url, v.license, v.sensitive, v.published_at,
            p.handle AS handle, p.display_name AS display_name
     FROM remote_hub_videos v
     JOIN profiles p ON p.id = v.profile_id
     WHERE v.removed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM profile_moderation_status s WHERE s.profile_id = v.profile_id AND s.status = 'suspended')
     ORDER BY v.published_at DESC, v.object_id
     LIMIT ?`,
  ).bind(Math.min(Math.max(Math.trunc(limit), 1), 100)).all<{
    object_id: string; title: string; duration_ms: number | null; watch_url: string; thumbnail_url: string | null;
    license: string; sensitive: number; published_at: string; handle: string; display_name: string;
  }>();
  return rows.results.map((row) => ({
    objectId: row.object_id,
    title: row.title,
    durationMs: row.duration_ms,
    watchUrl: row.watch_url,
    thumbnailUrl: row.thumbnail_url,
    license: row.license,
    sensitive: row.sensitive === 1,
    publishedAt: row.published_at,
    channelHandle: row.handle,
    channelName: row.display_name,
  }));
}
