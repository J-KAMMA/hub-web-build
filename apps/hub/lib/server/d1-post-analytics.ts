import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { SocialPostAnalyticsPayload } from "@/lib/post-analytics";

export async function recordSocialPostAnalyticsEvent(
  database: D1Database,
  payload: SocialPostAnalyticsPayload,
  viewerProfileId: string | null,
): Promise<boolean> {
  const post = await database.prepare(
    "SELECT author_profile_id FROM social_posts WHERE id = ? AND moderated_at IS NULL",
  ).bind(payload.postId).first<{ author_profile_id: string | null }>();
  if (!post || (viewerProfileId && post.author_profile_id === viewerProfileId)) return false;

  const now = new Date().toISOString();
  await database.prepare(
    "DELETE FROM social_post_analytics_events WHERE created_at < datetime('now', '-90 days')",
  ).run();
  const result = await database.prepare(
    `INSERT INTO social_post_analytics_events(event_id, post_id, event_type, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`,
  ).bind(payload.eventId, payload.postId, payload.eventType, now).run();
  return Number(result.meta.changes ?? 0) > 0;
}
