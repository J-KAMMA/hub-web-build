import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { normalizeVideoSource, type NormalizedVideoSource } from "@/lib/video-source";
import {
  createD1ExternalVideo,
  ExternalVideoAlreadyExistsError,
  type PublicVideoEntry
} from "@/lib/server/d1-videos";
import { lookupExternalVideoMetadata } from "@/lib/server/video-metadata";
import { getYouTubeEmbedPolicies } from "@/lib/server/youtube-embed-policy";
import { getYouTubeDataApiKey } from "@/lib/server/youtube-api-key";
import { recordVideoPostOrigin } from "@/lib/server/video-public-origin";

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:\)\]}>\u3001\u3002\uff01\uff09\uff1a\uff1b\uff1f]+$/u;
const MAX_VIDEOS_PER_POST = 3;

export type PublicVideoIngestSource = "social_post" | "thread" | "thread_reply";

export function extractSupportedVideoSources(body: string): NormalizedVideoSource[] {
  const sources: NormalizedVideoSource[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(URL_PATTERN)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, "");
    let source: NormalizedVideoSource;
    try {
      source = normalizeVideoSource(candidate);
    } catch {
      continue;
    }
    const key = `${source.storedProvider}:${source.externalVideoId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
    if (sources.length >= MAX_VIDEOS_PER_POST) break;
  }
  return sources;
}

export async function ingestVideosFromPublicBody(
  database: D1Database,
  viewer: Pick<Profile, "id" | "displayName">,
  body: string,
  options: {
    identityMode: "account" | "anonymous" | "guest" | undefined;
    ingestSource: PublicVideoIngestSource;
    /**
     * Required for ingestSource "social_post". Only a public post is ingested:
     * a followers-only post's link must not enter the public catalog. The post id
     * is recorded as the video's origin, so a later public post of an already
     * known video also makes it public.
     */
    post?: { id: string; audience: "public" | "followers" | string };
    fetcher?: typeof fetch;
    youtubeApiKey?: string;
  }
): Promise<PublicVideoEntry[]> {
  // Fail closed: a social post is ingested only when it is known to be public.
  if (options.ingestSource === "social_post" && options.post?.audience !== "public") return [];
  const originPostId = options.ingestSource === "social_post" ? options.post!.id : null;
  const pendingSources: NormalizedVideoSource[] = [];
  for (const source of extractSupportedVideoSources(body)) {
    const existing = await database.prepare(
      "SELECT id FROM external_videos WHERE provider = ? AND external_video_id = ? LIMIT 1"
    ).bind(source.storedProvider, source.externalVideoId).first<{ id: string }>();
    if (!existing) pendingSources.push(source);
    else if (originPostId) await recordVideoPostOrigin(database, existing.id, originPostId);
  }

  const eligibleSources = pendingSources.filter((source) => source.storedProvider !== "youtube");
  const pendingYouTube = pendingSources.filter((source) => source.storedProvider === "youtube");
  if (pendingYouTube.length > 0) {
    try {
      const policies = await getYouTubeEmbedPolicies(
        database,
        pendingYouTube.map((source) => source.externalVideoId),
        { apiKey: options.youtubeApiKey ?? getYouTubeDataApiKey(), fetcher: options.fetcher },
      );
      eligibleSources.push(...pendingYouTube.filter(
        (source) => policies.get(source.externalVideoId)?.allowed === true,
      ));
    } catch (error) {
      console.warn(JSON.stringify({
        event: "public_post_youtube_ingest_skipped",
        reason: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  }

  const metadata = await Promise.all(eligibleSources.map((source) =>
    lookupExternalVideoMetadata(source.sourceUrl, options.fetcher ?? fetch)
  ));
  const created: PublicVideoEntry[] = [];
  for (let index = 0; index < eligibleSources.length; index += 1) {
    const source = eligibleSources[index]!;
    const item = metadata[index]!;
    try {
      const video = await createD1ExternalVideo(database, viewer, {
        source: { ...source, thumbnailUrl: item.thumbnailUrl ?? source.thumbnailUrl },
        title: item.title ?? `${source.provider}の動画`,
        channel: item.channel ?? source.provider,
        category: "投稿から自動追加",
        purpose: "other",
        topic: "未分類",
        submitterVisible: options.identityMode !== "anonymous",
        ingestSource: options.ingestSource
      });
      created.push(video);
      if (originPostId) await recordVideoPostOrigin(database, video.id, originPostId);
    } catch (error) {
      if (!(error instanceof ExternalVideoAlreadyExistsError)) throw error;
      if (originPostId) {
        const raced = await database.prepare(
          "SELECT id FROM external_videos WHERE provider = ? AND external_video_id = ? LIMIT 1"
        ).bind(source.storedProvider, source.externalVideoId).first<{ id: string }>();
        if (raced) await recordVideoPostOrigin(database, raced.id, originPostId);
      }
    }
  }
  return created;
}

export async function safelyIngestVideosFromPublicBody(
  database: D1Database,
  viewer: Pick<Profile, "id" | "displayName">,
  body: string,
  options: Parameters<typeof ingestVideosFromPublicBody>[3]
): Promise<void> {
  try {
    await ingestVideosFromPublicBody(database, viewer, body, options);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "public_post_video_ingest_failed",
      source: options.ingestSource,
      error: error instanceof Error ? error.name : "UnknownError"
    }));
  }
}
