import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { getThreadPostQuota, type ThreadPostAction } from "@/lib/thread-abuse-controls";

export class HubPostRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`投稿が続いています。${Math.max(1, Math.ceil(retryAfterSeconds / 60))}分ほど待ってから、もう一度お試しください。`);
    this.name = "HubPostRateLimitError";
  }
}

export async function consumeD1PostQuota(
  database: D1Database,
  profile: Pick<Profile, "id" | "joinedAt">,
  action: ThreadPostAction,
  now = new Date(),
) {
  const quota = getThreadPostQuota(profile, action, now);
  const windowStartMs = Math.floor(now.getTime() / quota.windowMs) * quota.windowMs;
  const windowStartedAt = new Date(windowStartMs).toISOString();
  const expiresAt = new Date(windowStartMs + quota.windowMs).toISOString();
  const result = action === "social_post"
    ? await database.prepare(`INSERT INTO hub_social_post_rate_limit_buckets
        (profile_id, window_started_at, request_count, expires_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(profile_id, window_started_at) DO UPDATE SET
          request_count = request_count + 1
        WHERE request_count < ?`)
      .bind(profile.id, windowStartedAt, expiresAt, quota.limit).run()
    : await database.prepare(`INSERT INTO hub_rate_limit_buckets
        (profile_id, action, window_started_at, request_count, expires_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(profile_id, action, window_started_at) DO UPDATE SET
          request_count = request_count + 1
        WHERE request_count < ?`)
      .bind(profile.id, action, windowStartedAt, expiresAt, quota.limit).run();

  if (!result.meta.changes) {
    throw new HubPostRateLimitError(Math.max(1, Math.ceil((windowStartMs + quota.windowMs - now.getTime()) / 1000)));
  }
}

export async function pruneExpiredD1PostRateLimits(database: D1Database, now = new Date()) {
  const expiresBefore = now.toISOString();
  const threadBuckets = await database.prepare("DELETE FROM hub_rate_limit_buckets WHERE expires_at < ?")
    .bind(expiresBefore).run();
  const socialBuckets = await database.prepare("DELETE FROM hub_social_post_rate_limit_buckets WHERE expires_at < ?")
    .bind(expiresBefore).run();
  return {
    threadBuckets: threadBuckets.meta.changes ?? 0,
    socialBuckets: socialBuckets.meta.changes ?? 0,
  };
}
