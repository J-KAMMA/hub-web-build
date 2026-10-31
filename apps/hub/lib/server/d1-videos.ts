import { indexD1ContentTags, videoCategoryTagInput } from "@/lib/server/d1-content-tags";
import type { D1Database } from "@cloudflare/workers-types";

import type { PublicAccessGate } from "@/lib/access-gates/types";
import type { Profile } from "@/lib/domain";
import { publicVideoOriginSql, watchableVideoOriginSql } from "@/lib/server/video-public-origin";
import { redactGated, type GateAccessState } from "@/lib/server/gated-content";
import { durationSeconds } from "@/lib/v2-video";
import type { VideoContextInput, VideoPurpose } from "@/lib/video-context";
import type { NormalizedVideoSource, StoredExternalVideoProvider } from "@/lib/video-source";

export interface PublicVideoEntry {
  id: string;
  title: string;
  channel: string;
  category: string;
  purpose: VideoPurpose;
  topic: string;
  relatedHubpediaSlug?: string;
  provider: StoredExternalVideoProvider;
  sourceUrl: string;
  thumbnailUrl?: string;
  duration?: string;
  publishedAt: string;
  submittedByDisplayName?: string;
  createdAt: string;
  viewCount: number;
  safetyLevel?: "standard" | "sensitive" | "adult" | "medical" | "political";
  safetyNotice?: string;
  availabilityStatus?: "unknown" | "available" | "unavailable";
  broadcastStatus?: "video" | "live" | "upcoming" | "archive";
  metadataCheckedAt?: string;
  /** Owner profile handle; set only for provider 'hub' rows. */
  channelHandle?: string;
  /** Set when a token gate hides the source from this viewer. */
  accessGate?: GateAccessState;
}

type ExternalVideoRow = {
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
  channel_handle?: string | null;
};

export type VideoDiscoveryEntry = Pick<
  PublicVideoEntry,
  | "id"
  | "title"
  | "channel"
  | "category"
  | "purpose"
  | "topic"
  | "provider"
  | "sourceUrl"
  | "duration"
  | "publishedAt"
  | "createdAt"
  | "availabilityStatus"
>;

type VideoDiscoveryRow = {
  id: string;
  title: string;
  channel: string;
  category: string;
  purpose: VideoPurpose;
  topic: string;
  provider: StoredExternalVideoProvider;
  source_url: string;
  duration: string | null;
  published_at: string;
  created_at: string;
  availability_status: PublicVideoEntry["availabilityStatus"];
};

export type D1SearchDateBounds = {
  fromInclusive: string | null;
  toExclusive: string | null;
};

export interface CreateD1ExternalVideoInput extends VideoContextInput {
  source: NormalizedVideoSource;
  title: string;
  channel: string;
  category: string;
  submitterVisible?: boolean;
  ingestSource?: "manual" | "social_post" | "thread" | "thread_reply";
}

export class ExternalVideoAlreadyExistsError extends Error {
  constructor() {
    super("This video is already in the catalog.");
    this.name = "ExternalVideoAlreadyExistsError";
  }
}

function mapExternalVideo(row: ExternalVideoRow): PublicVideoEntry {
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
    publishedAt: row.published_at || row.created_at,
    submittedByDisplayName: row.submitter_display_name ?? undefined,
    createdAt: row.created_at,
    viewCount: Number(row.view_count)
    ,safetyLevel: row.safety_level ?? "standard"
    ,safetyNotice: row.safety_notice ?? undefined
    ,availabilityStatus: row.availability_status ?? "unknown"
    ,broadcastStatus: row.broadcast_status ?? "video"
    ,metadataCheckedAt: row.metadata_checked_at ?? undefined
    ,...(row.provider === "hub" && row.channel_handle ? { channelHandle: row.channel_handle } : {})
  };
}

// Followers-only post links never reach a public listing (video-public-origin.ts).
const PUBLIC_ORIGIN = publicVideoOriginSql("v");
const WATCHABLE_ORIGIN = watchableVideoOriginSql("v", "?2");

const PUBLIC_VIDEO_COLUMNS = `v.id, v.title, v.channel, v.category, v.purpose, v.topic,
  v.related_hubpedia_slug, v.provider,
  v.source_url, v.thumbnail_url, v.duration, v.published_at,
  CASE WHEN v.submitter_visible = 1 THEN p.display_name ELSE NULL END AS submitter_display_name,
  v.created_at, v.safety_level, v.safety_notice, v.availability_status, v.broadcast_status, v.metadata_checked_at,
  CASE WHEN v.provider = 'hub' THEN p.handle ELSE NULL END AS channel_handle,
  (v.archived_view_count + (SELECT COUNT(*) FROM external_video_views views WHERE views.video_id = v.id)) AS view_count`;

const VIDEO_DISCOVERY_COLUMNS = `v.id, v.title, v.channel, v.category, v.purpose, v.topic,
  v.provider, v.source_url, v.duration, v.published_at, v.created_at, v.availability_status`;

function mapVideoDiscoveryRow(row: VideoDiscoveryRow): VideoDiscoveryEntry {
  return {
    id: row.id,
    title: row.title,
    channel: row.channel,
    category: row.category,
    purpose: row.purpose,
    topic: row.topic,
    provider: row.provider,
    sourceUrl: row.source_url,
    duration: row.duration ?? undefined,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    availabilityStatus: row.availability_status ?? "unknown",
  };
}

export async function listD1VideoDiscoveryPage(
  database: D1Database,
  afterId?: string,
): Promise<{ videos: VideoDiscoveryEntry[]; nextCursor: string | null }> {
  const query = afterId
    ? `SELECT ${VIDEO_DISCOVERY_COLUMNS}
      FROM external_videos v
      WHERE v.status = 'active' AND ${PUBLIC_ORIGIN} AND v.id > ?
      ORDER BY v.id ASC
      LIMIT 201`
    : `SELECT ${VIDEO_DISCOVERY_COLUMNS}
      FROM external_videos v
      WHERE v.status = 'active' AND ${PUBLIC_ORIGIN}
      ORDER BY v.id ASC
      LIMIT 201`;
  const statement = database.prepare(query);
  const result = (afterId ? statement.bind(afterId) : statement).all<VideoDiscoveryRow>();
  const rows = (await result).results;
  const hasMore = rows.length > 200;
  const page = hasMore ? rows.slice(0, 200) : rows;
  return {
    videos: page.map(mapVideoDiscoveryRow),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function listD1ExternalVideosByIds(
  database: D1Database,
  ids: string[],
  viewerProfileId: string | null = null,
): Promise<PublicVideoEntry[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await database.prepare(`SELECT ${PUBLIC_VIDEO_COLUMNS}
    FROM external_videos v
    LEFT JOIN profiles p ON p.id = v.submitted_by_profile_id
    WHERE v.status = 'active' AND ${PUBLIC_ORIGIN} AND v.id IN (${placeholders})`)
    .bind(...ids)
    .all<ExternalVideoRow>();
  const byId = new Map(result.results.map((row) => [row.id, mapExternalVideo(row)]));
  return redactGated(database, viewerProfileId, ids.flatMap((id) => {
    const video = byId.get(id);
    return video ? [video] : [];
  }), "video");
}

export async function listD1ExternalVideos(database: D1Database, viewerProfileId: string | null = null): Promise<PublicVideoEntry[]> {
  const result = await database.prepare(`SELECT ${PUBLIC_VIDEO_COLUMNS}
    FROM external_videos v
    LEFT JOIN profiles p ON p.id = v.submitted_by_profile_id
    WHERE v.status = 'active' AND ${PUBLIC_ORIGIN}
    ORDER BY v.published_at DESC, v.created_at DESC
    LIMIT 200`).all<ExternalVideoRow>();
  return redactGated(database, viewerProfileId, result.results.map(mapExternalVideo), "video");
}

/**
 * Complete public video traversal for filtered search. The ordinary catalog
 * reader intentionally keeps its existing 200-row response contract; search
 * filters opt into an unbounded D1 candidate read so a date match cannot be
 * hidden behind that presentation limit.
 */
export async function listD1ExternalVideosForSearch(
  database: D1Database,
  dateBounds: D1SearchDateBounds,
): Promise<PublicVideoEntry[]> {
  const effectiveDate = "COALESCE(NULLIF(v.published_at, ''), NULLIF(v.created_at, ''))";
  const dateClauses: string[] = [];
  const dateBindings: string[] = [];
  if (dateBounds.fromInclusive || dateBounds.toExclusive) {
    dateClauses.push(`julianday(${effectiveDate}) IS NOT NULL`);
    if (dateBounds.fromInclusive) {
      dateClauses.push(`julianday(${effectiveDate}) >= julianday(?)`);
      dateBindings.push(dateBounds.fromInclusive);
    }
    if (dateBounds.toExclusive) {
      dateClauses.push(`julianday(${effectiveDate}) < julianday(?)`);
      dateBindings.push(dateBounds.toExclusive);
    }
  }
  const result = await database.prepare(`SELECT ${PUBLIC_VIDEO_COLUMNS}
    FROM external_videos v
    LEFT JOIN profiles p ON p.id = v.submitted_by_profile_id
    WHERE v.status = 'active' AND ${PUBLIC_ORIGIN}
      ${dateClauses.length ? `AND ${dateClauses.join(" AND ")}` : ""}
    ORDER BY julianday(${effectiveDate}) DESC, v.id ASC`)
    .bind(...dateBindings)
    .all<ExternalVideoRow>();
  // Search is not viewer-specific: gated videos keep only their public descriptor.
  return redactGated(database, null, result.results.map(mapExternalVideo), "video");
}

export async function listD1ExternalVideosPage(
  database: D1Database,
  limit: number,
  offset: number,
  options: { query?: string; category?: string; order?: string; viewerProfileId?: string | null } = {},
): Promise<{ videos: PublicVideoEntry[]; total: number; categories: { name: string; count: number }[] }> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const safeOffset = Math.max(0, Math.trunc(offset));
  const terms = (options.query ?? "").trim().split(/\s+/u).filter(Boolean);
  const predicates = ["v.status = 'active'", PUBLIC_ORIGIN, ...terms.map(() =>
    "instr(lower(coalesce(v.title,'') || ' ' || coalesce(v.channel,'') || ' ' || coalesce(v.category,'') || ' ' || coalesce(v.topic,'')), lower(?)) > 0")];
  if (options.order === "live") predicates.push("v.broadcast_status = 'live'");
  const category = "coalesce(nullif(trim(v.category), ''), '未分類')";
  const facetsWhere = predicates.join(" AND ");
  const values = [...terms];
  if (options.category) { predicates.push(`${category} = ?`); values.push(options.category); }
  const where = predicates.join(" AND ");
  const order = options.order === "popular" ? "view_count DESC," : "";
  const [result, count, facets] = await Promise.all([
    database.prepare(`SELECT ${PUBLIC_VIDEO_COLUMNS}
      FROM external_videos v
      LEFT JOIN profiles p ON p.id = v.submitted_by_profile_id
      WHERE ${where}
      ORDER BY ${order} v.published_at DESC, v.created_at DESC, v.id DESC
      LIMIT ? OFFSET ?`)
      .bind(...values, safeLimit, safeOffset)
      .all<ExternalVideoRow>(),
    database.prepare(`SELECT COUNT(*) AS total FROM external_videos v WHERE ${where}`).bind(...values)
      .first<{ total: number }>(),
    database.prepare(`SELECT ${category} AS name, COUNT(*) AS count FROM external_videos v
      WHERE ${facetsWhere} GROUP BY ${category} ORDER BY count DESC, name`).bind(...terms)
      .all<{ name: string; count: number }>(),
  ]);
  return {
    videos: await redactGated(database, options.viewerProfileId ?? null, result.results.map(mapExternalVideo), "video"),
    total: Number(count?.total ?? 0),
    categories: facets.results,
  };
}

export type AuthorHubVideoCard = {
  id: string;
  title: string;
  duration: string | null;
  publishedAt: string;
  href: string;
  locked: boolean;
  /** 鍵つきのとき、公開してよい閲覧条件（一覧の「何が要るか」表示用）。 */
  gate?: PublicAccessGate;
  thumbnailUrl?: string;
  isShort?: boolean;
};

/**
 * One author's Hub-made videos for the profile tab: catalog rows with provider 'hub' that the
 * public lists show (published, public, no hold, not age-restricted — PUBLIC_ORIGIN). Keyset on
 * (created_at, id) over idx_external_videos_submitter; no view counts or totals are read.
 */
export async function listD1AuthorHubVideosPage(
  database: D1Database,
  authorProfileId: string,
  options: { limit?: number; before?: { at: string; id: string } | null; viewerProfileId?: string | null } = {},
): Promise<{ videos: AuthorHubVideoCard[]; nextCursor: { at: string; id: string } | null }> {
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 20)));
  const before = options.before ?? null;
  const { results } = await database.prepare(`SELECT v.id, v.title, v.duration, v.published_at, v.created_at, v.thumbnail_url
    FROM external_videos v
    WHERE v.submitted_by_profile_id = ? AND v.provider = 'hub' AND v.status = 'active' AND ${PUBLIC_ORIGIN}
      ${before ? "AND (v.created_at < ? OR (v.created_at = ? AND v.id < ?))" : ""}
    ORDER BY v.created_at DESC, v.id DESC LIMIT ?`)
    .bind(authorProfileId, ...(before ? [before.at, before.at, before.id] : []), limit + 1)
    .all<{ id: string; title: string; duration: string | null; published_at: string | null; created_at: string; thumbnail_url: string | null }>();
  const page = results.slice(0, limit);
  const cards = page.map((row) => {
    const seconds = durationSeconds(row.duration);
    return {
      id: row.id,
      title: row.title,
      duration: row.duration ?? null,
      publishedAt: row.published_at || row.created_at,
      href: `/v2/videos/${encodeURIComponent(row.id)}`,
      ...(row.thumbnail_url ? { thumbnailUrl: row.thumbnail_url } : {}),
      isShort: seconds !== null && seconds > 0 && seconds <= 60,
    };
  });
  const visible = await redactGated(database, options.viewerProfileId ?? null, cards, "video");
  const last = page.at(-1);
  return {
    videos: visible.map(({ accessGate, ...card }) => ({ ...card, locked: Boolean(accessGate), ...(accessGate ? { gate: accessGate.gate } : {}) })),
    nextCursor: results.length > limit && last ? { at: last.created_at, id: last.id } : null,
  };
}

export async function getD1ExternalVideo(
  database: D1Database,
  videoId: string,
  viewerProfileId: string | null = null,
): Promise<PublicVideoEntry | null> {
  const row = await database.prepare(`SELECT ${PUBLIC_VIDEO_COLUMNS}
    FROM external_videos v
    LEFT JOIN profiles p ON p.id = v.submitted_by_profile_id
    WHERE v.id = ?1 AND v.status = 'active' AND ${WATCHABLE_ORIGIN}
    LIMIT 1`)
    .bind(videoId, viewerProfileId)
    .first<ExternalVideoRow>();
  if (!row) return null;
  const [video] = await redactGated(database, viewerProfileId, [mapExternalVideo(row)], "video", { context: "detail" });
  return video ?? null;
}

export async function findD1ExternalVideoByProviderId(
  database: D1Database,
  provider: StoredExternalVideoProvider,
  externalVideoId: string
): Promise<PublicVideoEntry | null> {
  const row = await database.prepare(`SELECT ${PUBLIC_VIDEO_COLUMNS}
    FROM external_videos v
    LEFT JOIN profiles p ON p.id = v.submitted_by_profile_id
    WHERE v.provider = ? AND v.external_video_id = ? AND v.status = 'active' AND ${PUBLIC_ORIGIN}
    LIMIT 1`)
    .bind(provider, externalVideoId)
    .first<ExternalVideoRow>();
  return row ? mapExternalVideo(row) : null;
}

export async function createD1ExternalVideo(
  database: D1Database,
  viewer: Pick<Profile, "id" | "displayName">,
  input: CreateD1ExternalVideoInput,
  now = new Date()
): Promise<PublicVideoEntry> {
  const timestamp = now.toISOString();
  const id = crypto.randomUUID();
  try {
    await database.prepare(`INSERT INTO external_videos (
        id, provider, external_video_id, source_url, title, channel, category,
        purpose, topic, related_hubpedia_slug,
        thumbnail_url, duration, published_at, submitted_by_profile_id,
        status, created_at, updated_at, submitter_visible, ingest_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'active', ?, ?, ?, ?)`)
      .bind(
        id,
        input.source.storedProvider,
        input.source.externalVideoId,
        input.source.sourceUrl,
        input.title,
        input.channel,
        input.category,
        input.purpose,
        input.topic,
        input.relatedHubpediaSlug ?? null,
        input.source.thumbnailUrl ?? null,
        timestamp,
        viewer.id,
        timestamp,
        timestamp,
        input.submitterVisible === false ? 0 : 1,
        input.ingestSource ?? "manual"
      ).run();
  } catch (error) {
    if (error instanceof Error && /unique.*external_videos/i.test(error.message)) throw new ExternalVideoAlreadyExistsError();
    throw error;
  }
  await indexD1ContentTags(database, "video", id, videoCategoryTagInput(input.category, input.topic));

  return {
    id,
    title: input.title,
    channel: input.channel,
    category: input.category,
    purpose: input.purpose,
    topic: input.topic,
    relatedHubpediaSlug: input.relatedHubpediaSlug,
    provider: input.source.storedProvider,
    sourceUrl: input.source.sourceUrl,
    thumbnailUrl: input.source.thumbnailUrl,
    publishedAt: timestamp,
    submittedByDisplayName: viewer.displayName,
    createdAt: timestamp,
    viewCount: 0
  };
}

export async function removeD1ExternalVideo(
  database: D1Database,
  videoId: string,
  authorProfileId: string,
  now = new Date()
): Promise<boolean> {
  const result = await database.prepare(`UPDATE external_videos
    SET status = 'removed', updated_at = ?
    WHERE id = ? AND submitted_by_profile_id = ? AND status = 'active'`)
    .bind(now.toISOString(), videoId, authorProfileId).run();
  return Number(result.meta.changes ?? 0) > 0;
}
