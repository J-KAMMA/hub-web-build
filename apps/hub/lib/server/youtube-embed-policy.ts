import type { D1Database } from "@cloudflare/workers-types";
import { isRedirectResponse } from "@/lib/redirect-guard";

const YOUTUBE_VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const POLICY_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

type CachedPolicyRow = {
  video_id: string;
  allowed: number;
  made_for_kids: number;
  reason: string;
};

const POLICY_REASONS = new Set<YouTubeEmbedPolicy["reason"]>([
  "allowed",
  "made_for_kids",
  "not_public",
  "not_embeddable",
  "age_restricted",
  "region_restricted",
  "not_found",
]);

export type YouTubeEmbedPolicy = {
  allowed: boolean;
  madeForKids: boolean;
  reason: "allowed" | "made_for_kids" | "not_public" | "not_embeddable" | "age_restricted" | "region_restricted" | "not_found";
};

export class YouTubeEmbedPolicyUnavailableError extends Error {
  constructor() {
    super("YouTube embed policy is temporarily unavailable.");
    this.name = "YouTubeEmbedPolicyUnavailableError";
  }
}

export function normalizeYouTubeVideoId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{11}$/u.test(value)) {
    throw new TypeError("A valid YouTube video ID is required.");
  }
  return value;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new YouTubeEmbedPolicyUnavailableError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new YouTubeEmbedPolicyUnavailableError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new YouTubeEmbedPolicyUnavailableError();
  }
}

function isAgeRestricted(contentDetails: object | undefined) {
  if (!contentDetails) return false;
  const contentRating = Reflect.get(contentDetails, "contentRating");
  return Boolean(
    contentRating
    && typeof contentRating === "object"
    && Reflect.get(contentRating, "ytRating") === "ytAgeRestricted"
  );
}

function isRegionRestricted(contentDetails: object | undefined) {
  if (!contentDetails) return false;
  const restriction = Reflect.get(contentDetails, "regionRestriction");
  if (!restriction || typeof restriction !== "object") return false;
  const allowed = Reflect.get(restriction, "allowed");
  const blocked = Reflect.get(restriction, "blocked");
  return (Array.isArray(allowed) && allowed.length > 0)
    || (Array.isArray(blocked) && blocked.length > 0);
}

function policyFromStatus(status: object, contentDetails?: object): YouTubeEmbedPolicy {
  const madeForKids = Reflect.get(status, "madeForKids") === true;
  // Hub is a general-audience service. Child-directed videos are excluded from
  // playback, catalog registration, search results, and automatic ingestion.
  if (madeForKids) return { allowed: false, madeForKids: true, reason: "made_for_kids" };
  if (Reflect.get(status, "privacyStatus") !== "public") {
    return { allowed: false, madeForKids: false, reason: "not_public" };
  }
  if (Reflect.get(status, "embeddable") !== true) {
    return { allowed: false, madeForKids: false, reason: "not_embeddable" };
  }
  if (isAgeRestricted(contentDetails)) {
    return { allowed: false, madeForKids: false, reason: "age_restricted" };
  }
  if (isRegionRestricted(contentDetails)) {
    return { allowed: false, madeForKids: false, reason: "region_restricted" };
  }
  return { allowed: true, madeForKids: false, reason: "allowed" };
}

function parsePolicies(payload: unknown, requestedIds: string[]): Map<string, YouTubeEmbedPolicy> {
  const items = payload && typeof payload === "object" ? Reflect.get(payload, "items") : undefined;
  if (!Array.isArray(items)) throw new YouTubeEmbedPolicyUnavailableError();
  const policies = new Map<string, YouTubeEmbedPolicy>(
    requestedIds.map((videoId) => [
      videoId,
      { allowed: false, madeForKids: false, reason: "not_found" },
    ]),
  );
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const videoId = Reflect.get(item, "id");
    const status = Reflect.get(item, "status");
    const contentDetails = Reflect.get(item, "contentDetails");
    if (typeof videoId !== "string" || !requestedIds.includes(videoId)) continue;
    if (!status || typeof status !== "object") throw new YouTubeEmbedPolicyUnavailableError();
    policies.set(
      videoId,
      policyFromStatus(status, contentDetails && typeof contentDetails === "object" ? contentDetails : undefined),
    );
  }
  return policies;
}

export async function getYouTubeEmbedPolicies(
  database: D1Database,
  videoIdValues: unknown[],
  options: { apiKey?: string; fetcher?: typeof fetch; now?: Date } = {},
): Promise<Map<string, YouTubeEmbedPolicy>> {
  const videoIds = [...new Set(videoIdValues.map(normalizeYouTubeVideoId))];
  if (videoIds.length === 0) return new Map();
  if (videoIds.length > 50) throw new TypeError("At most 50 YouTube video IDs can be checked at once.");
  const now = options.now ?? new Date();
  const placeholders = videoIds.map(() => "?").join(", ");
  const cachedRows = await database.prepare(
    `SELECT video_id, allowed, made_for_kids, reason
     FROM youtube_embed_policies
     WHERE video_id IN (${placeholders}) AND expires_at > ?`,
  ).bind(...videoIds, now.toISOString()).all<CachedPolicyRow>();
  const policies = new Map<string, YouTubeEmbedPolicy>();
  for (const cached of cachedRows.results) {
    if (!videoIds.includes(cached.video_id)) continue;
    if (!POLICY_REASONS.has(cached.reason as YouTubeEmbedPolicy["reason"])) continue;
    policies.set(cached.video_id, {
      allowed: cached.allowed === 1,
      madeForKids: cached.made_for_kids === 1,
      reason: cached.reason as YouTubeEmbedPolicy["reason"],
    });
  }
  const missingIds = videoIds.filter((videoId) => !policies.has(videoId));
  if (missingIds.length === 0) return policies;

  const apiKey = options.apiKey?.trim();
  if (!apiKey) throw new YouTubeEmbedPolicyUnavailableError();
  const endpoint = new URL(YOUTUBE_VIDEOS_ENDPOINT);
  endpoint.searchParams.set("part", "status,contentDetails");
  endpoint.searchParams.set("id", missingIds.join(","));
  endpoint.searchParams.set("key", apiKey);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new YouTubeEmbedPolicyUnavailableError();
  }
  if (!response.ok || isRedirectResponse(response)) throw new YouTubeEmbedPolicyUnavailableError();
  const fetchedPolicies = parsePolicies(await readBoundedJson(response), missingIds);
  const checkedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + POLICY_TTL_MS).toISOString();
  await database.batch(missingIds.map((videoId) => {
    const policy = fetchedPolicies.get(videoId)!;
    policies.set(videoId, policy);
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
    ).bind(
      videoId,
      policy.allowed ? 1 : 0,
      policy.madeForKids ? 1 : 0,
      policy.reason,
      checkedAt,
      expiresAt,
    );
  }));
  return policies;
}

export async function getYouTubeEmbedPolicy(
  database: D1Database,
  videoIdValue: unknown,
  options: { apiKey?: string; fetcher?: typeof fetch; now?: Date } = {},
): Promise<YouTubeEmbedPolicy> {
  const videoId = normalizeYouTubeVideoId(videoIdValue);
  const policies = await getYouTubeEmbedPolicies(database, [videoId], options);
  const policy = policies.get(videoId);
  if (!policy) throw new YouTubeEmbedPolicyUnavailableError();
  return policy;
}
