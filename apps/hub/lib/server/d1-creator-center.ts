import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  creatorActivityCutoff,
  type CreatorActivityPeriod,
} from "@/lib/creator-activity-period";

export type CreatorActivitySummary = {
  posts: number;
  replies: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  impressions: number;
  linkTransitions: number;
  workListings: number;
  jobListings: number;
  communities: number;
};

type CountRow = { total: number | null };
type PostActivityRow = {
  posts: number | null;
  replies: number | null;
  reposts: number | null;
  likes: number | null;
  bookmarks: number | null;
  impressions: number | null;
  link_transitions: number | null;
};

async function count(
  database: D1Database,
  query: string,
  profileId: string,
  cutoff: string | null,
): Promise<number> {
  const row = await database.prepare(query).bind(profileId, cutoff).first<CountRow>();
  return Math.max(0, Number(row?.total ?? 0));
}

export async function getD1CreatorActivitySummary(
  database: D1Database,
  profileId: string,
  period: CreatorActivityPeriod = "all",
): Promise<CreatorActivitySummary> {
  const cutoff = creatorActivityCutoff(period);
  const [postActivity, workListings, jobListings, communities] = await Promise.all([
    database.prepare(`SELECT
        COALESCE(SUM(CASE WHEN ?2 IS NULL OR post.created_at >= ?2 THEN 1 ELSE 0 END), 0) AS posts,
        COALESCE(SUM((SELECT COUNT(*) FROM social_posts reply
          WHERE reply.reply_to_post_id = post.id AND (?2 IS NULL OR reply.created_at >= ?2))), 0) AS replies,
        COALESCE(SUM((SELECT COUNT(*) FROM social_posts repost
          WHERE repost.repost_of_target_type = 'social_post' AND repost.repost_of_target_id = post.id
            AND (?2 IS NULL OR repost.created_at >= ?2))), 0) AS reposts,
        COALESCE(SUM((SELECT COUNT(*) FROM reactions reaction
          WHERE reaction.target_type = 'social_post' AND reaction.target_id = post.id AND reaction.kind = 'like'
            AND (?2 IS NULL OR reaction.created_at >= ?2))), 0) AS likes,
        COALESCE(SUM((SELECT COUNT(*) FROM bookmarks bookmark
          WHERE bookmark.target_type = 'social_post' AND bookmark.target_id = post.id
            AND (?2 IS NULL OR bookmark.created_at >= ?2))), 0) AS bookmarks
        ,COALESCE(SUM((SELECT COUNT(*) FROM social_post_analytics_events event
          WHERE event.post_id = post.id AND event.event_type = 'viewable_impression'
            AND (?2 IS NULL OR event.created_at >= ?2))), 0) AS impressions
        ,COALESCE(SUM((SELECT COUNT(*) FROM social_post_analytics_events event
          WHERE event.post_id = post.id AND event.event_type = 'link_transition'
            AND (?2 IS NULL OR event.created_at >= ?2))), 0) AS link_transitions
      FROM social_posts post
      WHERE post.author_profile_id = ?1`)
      .bind(profileId, cutoff)
      .first<PostActivityRow>(),
    count(
      database,
      "SELECT COUNT(*) AS total FROM work_listings WHERE owner_profile_id = ?1 AND kind IN ('service', 'request') AND (?2 IS NULL OR created_at >= ?2)",
      profileId,
      cutoff,
    ),
    count(
      database,
      "SELECT COUNT(*) AS total FROM work_listings WHERE owner_profile_id = ?1 AND kind = 'job' AND (?2 IS NULL OR created_at >= ?2)",
      profileId,
      cutoff,
    ),
    count(
      database,
      "SELECT COUNT(*) AS total FROM communities WHERE owner_profile_id = ?1 AND (?2 IS NULL OR created_at >= ?2)",
      profileId,
      cutoff,
    ),
  ]);

  return {
    posts: Math.max(0, Number(postActivity?.posts ?? 0)),
    replies: Math.max(0, Number(postActivity?.replies ?? 0)),
    reposts: Math.max(0, Number(postActivity?.reposts ?? 0)),
    likes: Math.max(0, Number(postActivity?.likes ?? 0)),
    bookmarks: Math.max(0, Number(postActivity?.bookmarks ?? 0)),
    impressions: Math.max(0, Number(postActivity?.impressions ?? 0)),
    linkTransitions: Math.max(0, Number(postActivity?.link_transitions ?? 0)),
    workListings,
    jobListings,
    communities,
  };
}
