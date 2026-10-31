import type { D1Database } from "@cloudflare/workers-types";

import type { NormalizedVideoSource } from "@/lib/video-source";
import { YouTubeEmbedPolicyUnavailableError } from "@/lib/server/youtube-embed-policy";
import { isRedirectResponse } from "@/lib/redirect-guard";

export type YouTubeBatchVideo = {
  source: NormalizedVideoSource;
  title: string;
  channel: string;
  thumbnailUrl?: string;
  allowed: boolean;
  reason: string;
};

export class YouTubeDailyQuotaExhaustedError extends Error {
  constructor() {
    super("YouTube APIの日次クォータに達しました。翌日に自動再開します。");
    this.name = "YouTubeDailyQuotaExhaustedError";
  }
}

function pacificQuotaDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function reserveQuotaUnit(database: D1Database) {
  const now = new Date();
  const quotaDate = pacificQuotaDate(now);
  await database.prepare(
    `INSERT INTO youtube_api_quota_usage (quota_date, used_units, updated_at)
     VALUES (?, 0, ?) ON CONFLICT(quota_date) DO NOTHING`,
  ).bind(quotaDate, now.toISOString()).run();
  const result = await database.prepare(
    `UPDATE youtube_api_quota_usage SET used_units = used_units + 1, updated_at = ?
     WHERE quota_date = ? AND used_units < 10000`,
  ).bind(now.toISOString(), quotaDate).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new YouTubeDailyQuotaExhaustedError();
}

type YouTubeItem = {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
  };
  status?: { privacyStatus?: string; embeddable?: boolean; madeForKids?: boolean };
  contentDetails?: {
    contentRating?: { ytRating?: string };
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
  };
};

function policy(item: YouTubeItem): { allowed: boolean; madeForKids: boolean; reason: string } {
  const madeForKids = item.status?.madeForKids === true;
  if (madeForKids) return { allowed: false, madeForKids, reason: "made_for_kids" };
  if (item.status?.privacyStatus !== "public") return { allowed: false, madeForKids, reason: "not_public" };
  if (item.status?.embeddable !== true) return { allowed: false, madeForKids, reason: "not_embeddable" };
  if (item.contentDetails?.contentRating?.ytRating === "ytAgeRestricted") {
    return { allowed: false, madeForKids, reason: "age_restricted" };
  }
  const region = item.contentDetails?.regionRestriction;
  if ((region?.allowed?.length ?? 0) > 0 || (region?.blocked?.length ?? 0) > 0) {
    return { allowed: false, madeForKids, reason: "region_restricted" };
  }
  return { allowed: true, madeForKids, reason: "allowed" };
}

export async function lookupYouTubeVideoBatch(
  database: D1Database,
  sources: NormalizedVideoSource[],
  apiKeyValue: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Map<string, YouTubeBatchVideo>> {
  const uniqueSources = [...new Map(sources.map((source) => [source.externalVideoId, source])).values()];
  if (uniqueSources.length === 0) return new Map();
  if (uniqueSources.length > 50) throw new TypeError("At most 50 YouTube videos can be checked at once.");
  const apiKey = apiKeyValue?.trim();
  if (!apiKey) throw new YouTubeEmbedPolicyUnavailableError();
  await reserveQuotaUnit(database);

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "snippet,status,contentDetails");
  endpoint.searchParams.set("id", uniqueSources.map((source) => source.externalVideoId).join(","));
  endpoint.searchParams.set("key", apiKey);
  const response = await fetcher(endpoint, {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok || isRedirectResponse(response)) throw new YouTubeEmbedPolicyUnavailableError();
  const payload = await response.json().catch(() => null) as { items?: YouTubeItem[] } | null;
  if (!Array.isArray(payload?.items)) throw new YouTubeEmbedPolicyUnavailableError();

  const byId = new Map(payload.items.map((item) => [item.id, item]));
  const now = new Date();
  const checkedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString();
  const result = new Map<string, YouTubeBatchVideo>();
  const statements = uniqueSources.map((source) => {
    const item = byId.get(source.externalVideoId);
    const checked = item ? policy(item) : { allowed: false, madeForKids: false, reason: "not_found" };
    if (item) {
      result.set(source.externalVideoId, {
        source,
        title: item.snippet?.title?.trim() || "YouTube動画",
        channel: item.snippet?.channelTitle?.trim() || "YouTube",
        thumbnailUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? source.thumbnailUrl,
        allowed: checked.allowed,
        reason: checked.reason,
      });
    }
    return database.prepare(
      `INSERT INTO youtube_embed_policies
         (video_id, allowed, made_for_kids, reason, checked_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET
         allowed = excluded.allowed,
         made_for_kids = excluded.made_for_kids,
         reason = excluded.reason,
         checked_at = excluded.checked_at,
         expires_at = excluded.expires_at`,
    ).bind(source.externalVideoId, checked.allowed ? 1 : 0, checked.madeForKids ? 1 : 0, checked.reason, checkedAt, expiresAt);
  });
  await database.batch(statements);
  return result;
}
