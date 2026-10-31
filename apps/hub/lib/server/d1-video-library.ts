import type { D1Database } from "@cloudflare/workers-types";

import { publicVideoOriginSql } from "@/lib/server/video-public-origin";

import type { PublicVideoEntry } from "@/lib/server/d1-videos";
import type { VideoPurpose } from "@/lib/video-context";
import type { StoredExternalVideoProvider } from "@/lib/video-source";

type VideoRow = {
  id: string;
  title: string;
  channel: string;
  category: string;
  purpose: VideoPurpose;
  topic: string;
  related_hubpedia_slug: string | null;
  provider: StoredExternalVideoProvider;
  source_url: string;
  thumbnail_url: string | null;
  duration: string | null;
  published_at: string;
  submitter_display_name: string | null;
  created_at: string;
  view_count: number;
  safety_level: PublicVideoEntry["safetyLevel"];
  safety_notice: string | null;
  availability_status: PublicVideoEntry["availabilityStatus"];
  broadcast_status: PublicVideoEntry["broadcastStatus"];
  metadata_checked_at: string | null;
};

type RankedVideoRow = VideoRow & {
  save_count: number;
  recent_save_count: number;
  view_count: number;
  recent_view_count: number;
};

type PlaylistRow = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type PlaylistItemRow = { playlist_id: string; video_id: string };

export interface VideoPlaylist {
  id: string;
  title: string;
  description: string;
  videoIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RankedVideoEntry extends PublicVideoEntry {
  saveCount: number;
  recentSaveCount: number;
  recentViewCount: number;
}

export class InvalidVideoPlaylistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVideoPlaylistError";
  }
}

export class VideoPlaylistNotFoundError extends Error {
  constructor() {
    super("Playlist was not found.");
    this.name = "VideoPlaylistNotFoundError";
  }
}

const VIDEO_COLUMNS = `v.id, v.title, v.channel, v.category, v.purpose, v.topic,
  v.related_hubpedia_slug, v.provider, v.source_url, v.thumbnail_url, v.duration,
  v.published_at, CASE WHEN v.submitter_visible = 1 THEN p.display_name ELSE NULL END AS submitter_display_name, v.created_at,
  v.safety_level, v.safety_notice, v.availability_status, v.broadcast_status, v.metadata_checked_at,
  (v.archived_view_count + (SELECT COUNT(*) FROM external_video_views views WHERE views.video_id = v.id)) AS view_count`;

function mapVideo(row: VideoRow): PublicVideoEntry {
  return {
    id: row.id,
    title: row.title,
    channel: row.channel,
    category: row.category,
    purpose: row.purpose,
    topic: row.topic,
    relatedHubpediaSlug: row.related_hubpedia_slug ?? undefined,
    provider: row.provider,
    sourceUrl: row.source_url,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    duration: row.duration ?? undefined,
    publishedAt: row.published_at,
    submittedByDisplayName: row.submitter_display_name ?? undefined,
    createdAt: row.created_at,
    viewCount: Number(row.view_count),
    safetyLevel: row.safety_level ?? "standard",
    safetyNotice: row.safety_notice ?? undefined,
    availabilityStatus: row.availability_status ?? "unknown",
    broadcastStatus: row.broadcast_status ?? "video",
    metadataCheckedAt: row.metadata_checked_at ?? undefined
  };
}

function normalizeText(value: unknown, field: string, maxLength: number, required: boolean): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw new InvalidVideoPlaylistError(`${field} must be a string.`);
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (required && !normalized) throw new InvalidVideoPlaylistError(`${field} is required.`);
  if (normalized.length > maxLength || /\p{Cc}/u.test(normalized)) {
    throw new InvalidVideoPlaylistError(`${field} is invalid.`);
  }
  return normalized;
}

export function parseVideoPlaylistInput(input: unknown): { title: string; description: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidVideoPlaylistError("JSON body is required.");
  }
  const record = input as Record<string, unknown>;
  return {
    title: normalizeText(record.title, "title", 80, true),
    description: normalizeText(record.description, "description", 500, false)
  };
}

export function parseVideoPlaylistUpdate(input: unknown): { title?: string; description?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidVideoPlaylistError("JSON body is required.");
  }
  const record = input as Record<string, unknown>;
  const result: { title?: string; description?: string } = {};
  if (Object.hasOwn(record, "title")) result.title = normalizeText(record.title, "title", 80, true);
  if (Object.hasOwn(record, "description")) result.description = normalizeText(record.description, "description", 500, false);
  if (result.title === undefined && result.description === undefined) {
    throw new InvalidVideoPlaylistError("title or description is required.");
  }
  return result;
}

export async function saveD1ExternalVideo(
  database: D1Database,
  profileId: string,
  videoId: string,
  now = new Date()
): Promise<boolean> {
  const video = await database.prepare("SELECT id FROM external_videos WHERE id = ? AND status = 'active' LIMIT 1")
    .bind(videoId).first<{ id: string }>();
  if (!video) return false;
  await database.prepare(`INSERT INTO external_video_saves (profile_id, video_id, created_at)
    VALUES (?, ?, ?) ON CONFLICT(profile_id, video_id) DO NOTHING`)
    .bind(profileId, videoId, now.toISOString()).run();
  return true;
}

export async function unsaveD1ExternalVideo(database: D1Database, profileId: string, videoId: string): Promise<void> {
  await database.prepare("DELETE FROM external_video_saves WHERE profile_id = ? AND video_id = ?")
    .bind(profileId, videoId).run();
}

export async function listD1SavedVideos(database: D1Database, profileId: string): Promise<PublicVideoEntry[]> {
  const result = await database.prepare(`SELECT ${VIDEO_COLUMNS}
    FROM external_video_saves s
    JOIN external_videos v ON v.id = s.video_id AND v.status = 'active'
    LEFT JOIN profiles p ON p.id = v.submitted_by_profile_id
    WHERE s.profile_id = ?
    ORDER BY s.created_at DESC LIMIT 500`).bind(profileId).all<VideoRow>();
  return result.results.map(mapVideo);
}

export class InvalidSavedVideoCursorError extends Error {
  constructor() { super('Invalid saved video cursor.'); this.name = 'InvalidSavedVideoCursorError'; }
}

export function parseSavedVideoCursor(cursor: string): { savedAt: string; videoId: string } | null {
  if (cursor === '') return null;
  if (typeof cursor !== 'string' || cursor.length > 153) throw new InvalidSavedVideoCursorError();
  const match = cursor.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([A-Za-z0-9_-]{1,128})$/);
  if (!match || !Number.isFinite(Date.parse(match[1])) || new Date(match[1]).toISOString() !== match[1]) throw new InvalidSavedVideoCursorError();
  return {savedAt:match[1], videoId:match[2]};
}

/** Desktop keyset pages; the legacy Web list remains unchanged. */
export async function listD1SavedVideosPage(database: D1Database, profileId: string, cursor = ''): Promise<{ savedVideos: PublicVideoEntry[]; nextCursor: string | null }> {
  const after = parseSavedVideoCursor(cursor);
  const result = await database.prepare(`SELECT ${VIDEO_COLUMNS}, s.created_at AS saved_at
    FROM external_video_saves s
    JOIN external_videos v ON v.id = s.video_id AND v.status = 'active'
    LEFT JOIN profiles p ON p.id = v.submitted_by_profile_id
    WHERE s.profile_id = ? ${after ? 'AND (s.created_at < ? OR (s.created_at = ? AND s.video_id < ?))' : ''}
    ORDER BY s.created_at DESC, s.video_id DESC LIMIT 101`)
    .bind(profileId, ...(after ? [after.savedAt, after.savedAt, after.videoId] : [])).all<VideoRow & { saved_at: string }>();
  const rows = result.results.slice(0,100), last = rows.at(-1);
  return {savedVideos:rows.map(mapVideo), nextCursor:result.results.length > 100 && last ? `${last.saved_at}|${last.id}` : null};
}

export async function listD1VideoPlaylists(database: D1Database, profileId: string): Promise<VideoPlaylist[]> {
  const playlists = await database.prepare(`SELECT id, title, description, created_at, updated_at
    FROM external_video_playlists WHERE owner_profile_id = ? ORDER BY updated_at DESC LIMIT 100`)
    .bind(profileId).all<PlaylistRow>();
  if (playlists.results.length === 0) return [];
  const items = await database.prepare(`SELECT i.playlist_id, i.video_id
    FROM external_video_playlist_items i
    JOIN external_video_playlists l ON l.id = i.playlist_id
    JOIN external_videos v ON v.id = i.video_id AND v.status = 'active'
    WHERE l.owner_profile_id = ?
    ORDER BY i.playlist_id, i.position, i.created_at`).bind(profileId).all<PlaylistItemRow>();
  const videoIdsByPlaylist = new Map<string, string[]>();
  for (const item of items.results) {
    const videoIds = videoIdsByPlaylist.get(item.playlist_id) ?? [];
    videoIds.push(item.video_id);
    videoIdsByPlaylist.set(item.playlist_id, videoIds);
  }
  return playlists.results.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    videoIds: videoIdsByPlaylist.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function createD1VideoPlaylist(
  database: D1Database,
  profileId: string,
  input: { title: string; description: string },
  now = new Date()
): Promise<VideoPlaylist> {
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  await database.prepare(`INSERT INTO external_video_playlists
    (id, owner_profile_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, profileId, input.title, input.description, timestamp, timestamp).run();
  return { id, ...input, videoIds: [], createdAt: timestamp, updatedAt: timestamp };
}

export async function updateD1VideoPlaylist(
  database: D1Database,
  profileId: string,
  playlistId: string,
  input: { title?: string; description?: string },
  now = new Date()
): Promise<boolean> {
  const result = await database.prepare(`UPDATE external_video_playlists SET
    title = COALESCE(?, title), description = COALESCE(?, description), updated_at = ?
    WHERE id = ? AND owner_profile_id = ?`)
    .bind(input.title ?? null, input.description ?? null, now.toISOString(), playlistId, profileId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function deleteD1VideoPlaylist(database: D1Database, profileId: string, playlistId: string): Promise<boolean> {
  const result = await database.prepare("DELETE FROM external_video_playlists WHERE id = ? AND owner_profile_id = ?")
    .bind(playlistId, profileId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function addD1VideoPlaylistItem(
  database: D1Database,
  profileId: string,
  playlistId: string,
  videoId: string,
  now = new Date()
): Promise<boolean> {
  const result = await database.prepare(`INSERT INTO external_video_playlist_items
      (playlist_id, video_id, position, created_at)
    SELECT l.id, v.id,
      COALESCE((SELECT MAX(position) + 1 FROM external_video_playlist_items WHERE playlist_id = l.id), 0), ?
    FROM external_video_playlists l
    JOIN external_videos v ON v.id = ? AND v.status = 'active'
    WHERE l.id = ? AND l.owner_profile_id = ?
    ON CONFLICT(playlist_id, video_id) DO NOTHING`)
    .bind(now.toISOString(), videoId, playlistId, profileId).run();
  if (Number(result.meta.changes ?? 0) > 0) {
    await saveD1ExternalVideo(database, profileId, videoId, now);
    return true;
  }
  const playlist = await database.prepare("SELECT id FROM external_video_playlists WHERE id = ? AND owner_profile_id = ?")
    .bind(playlistId, profileId).first<{ id: string }>();
  if (!playlist) throw new VideoPlaylistNotFoundError();
  const video = await database.prepare("SELECT id FROM external_videos WHERE id = ? AND status = 'active'")
    .bind(videoId).first<{ id: string }>();
  if (!video) return false;
  await saveD1ExternalVideo(database, profileId, videoId, now);
  return true; // Existing membership is an idempotent success.
}

export async function removeD1VideoPlaylistItem(
  database: D1Database,
  profileId: string,
  playlistId: string,
  videoId: string
): Promise<boolean> {
  const result = await database.prepare(`DELETE FROM external_video_playlist_items
    WHERE playlist_id = ? AND video_id = ? AND EXISTS (
      SELECT 1 FROM external_video_playlists l WHERE l.id = ? AND l.owner_profile_id = ?
    )`).bind(playlistId, videoId, playlistId, profileId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function listD1VideoRankings(database: D1Database, now = new Date()): Promise<{
  popular: RankedVideoEntry[];
  rising: RankedVideoEntry[];
  recent: RankedVideoEntry[];
}> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const baseQuery = `SELECT ${VIDEO_COLUMNS},
      COUNT(s.video_id) AS save_count,
      SUM(CASE WHEN s.created_at >= ? THEN 1 ELSE 0 END) AS recent_save_count,
      (SELECT COUNT(*) FROM external_video_views views WHERE views.video_id = v.id AND views.created_at >= ?) AS recent_view_count
    FROM external_videos v
    LEFT JOIN profiles p ON p.id = v.submitted_by_profile_id
    LEFT JOIN external_video_saves s ON s.video_id = v.id
    WHERE v.status = 'active' AND ${publicVideoOriginSql("v")}
    GROUP BY v.id`;
  const [popularRows, risingRows, recentRows] = await Promise.all([
    database.prepare(`${baseQuery} ORDER BY view_count DESC, save_count DESC, v.published_at DESC LIMIT 50`)
      .bind(sevenDaysAgo, sevenDaysAgo).all<RankedVideoRow>(),
    database.prepare(`${baseQuery} ORDER BY recent_view_count DESC, recent_save_count DESC, view_count DESC, v.published_at DESC LIMIT 50`)
      .bind(sevenDaysAgo, sevenDaysAgo).all<RankedVideoRow>(),
    database.prepare(`${baseQuery} ORDER BY v.published_at DESC, v.created_at DESC LIMIT 50`)
      .bind(sevenDaysAgo, sevenDaysAgo).all<RankedVideoRow>()
  ]);
  const mapRanked = (row: RankedVideoRow): RankedVideoEntry => ({
    ...mapVideo(row),
    saveCount: Number(row.save_count),
    recentSaveCount: Number(row.recent_save_count),
    viewCount: Number(row.view_count),
    recentViewCount: Number(row.recent_view_count)
  });
  return {
    popular: popularRows.results.map(mapRanked),
    rising: risingRows.results.map(mapRanked),
    recent: recentRows.results.map(mapRanked)
  };
}
