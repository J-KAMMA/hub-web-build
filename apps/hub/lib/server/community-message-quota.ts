import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { getThreadPostQuota } from "@/lib/thread-abuse-controls";
import { HubPostRateLimitError } from "./d1-rate-limit";

export function communityMessageQuota(database: D1Database, profile: Pick<Profile, "id" | "joinedAt">, now = new Date()) {
  const quota = getThreadPostQuota(profile, "thread_reply", now);
  const start = Math.floor(now.getTime() / quota.windowMs) * quota.windowMs;
  const window = new Date(start).toISOString();
  const expires = new Date(start + quota.windowMs).toISOString();
  return {
    // A zero count violates the bucket's CHECK. In a D1 batch this rolls back
    // the operation claim and message as well, instead of silently skipping quota.
    statement: database.prepare(`INSERT INTO hub_rate_limit_buckets
      (profile_id, action, window_started_at, request_count, expires_at)
      VALUES (?, 'thread_reply', ?, 1, ?)
      ON CONFLICT(profile_id, action, window_started_at) DO UPDATE SET
      request_count = CASE WHEN request_count < ? THEN request_count + 1 ELSE 0 END`)
      .bind(profile.id, window, expires, quota.limit),
    async rethrowIfExhausted() {
      const bucket = await database.prepare("SELECT request_count FROM hub_rate_limit_buckets WHERE profile_id = ? AND action = 'thread_reply' AND window_started_at = ?")
        .bind(profile.id, window).first<{ request_count: number }>();
      if (bucket && bucket.request_count >= quota.limit) {
        throw new HubPostRateLimitError(Math.max(1, Math.ceil((start + quota.windowMs - Date.now()) / 1000)));
      }
    },
  };
}
