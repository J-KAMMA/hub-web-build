import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  buildHubProfileGraphProjection,
  type HubGraphFollowRow,
  type HubGraphKnowledgeRow,
  type HubGraphPostRow,
  type HubGraphProfileRow,
} from "@/lib/platform/hub-graph-projection";

export async function getD1HubProfileGraph(
  database: D1Database,
  profileSelector: string,
  limit: number,
) {
  const profile = await database
    .prepare(
      `SELECT p.id, p.handle, p.display_name
       FROM profiles p
       WHERE (p.id = ? OR p.handle = ? COLLATE NOCASE)
         AND NOT EXISTS (
           SELECT 1 FROM profile_moderation_status moderation
           WHERE moderation.profile_id = p.id
             AND moderation.status = 'suspended'
         )
       LIMIT 1`,
    )
    .bind(profileSelector, profileSelector)
    .first<HubGraphProfileRow>();
  if (!profile) return null;

  const [follows, posts, knowledge] = await database.batch([
    database
      .prepare(
        `SELECT p.id, p.handle, p.display_name, f.created_at
         FROM follows f
         JOIN profiles p ON p.id = f.followed_profile_id
         WHERE f.follower_profile_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM profile_moderation_status moderation
             WHERE moderation.profile_id = p.id
               AND moderation.status = 'suspended'
           )
         ORDER BY f.created_at DESC
         LIMIT ?`,
      )
      .bind(profile.id, limit),
    database
      .prepare(
        `SELECT post.id, post.created_at
         FROM social_posts post
         WHERE post.author_profile_id = ?
           AND post.audience = 'public'
           AND post.moderated_at IS NULL
         ORDER BY post.created_at DESC
         LIMIT ?`,
      )
      .bind(profile.id, limit),
    database
      .prepare(
        `SELECT link.article_slug, link.source_id,
                post.created_at AS source_created_at,
                link.created_at AS linked_at
         FROM hubpedia_social_knowledge_links link
         JOIN social_posts post
           ON link.source_type = 'social_post'
          AND post.id = link.source_id
         WHERE link.proposed_by_profile_id = ?
           AND link.status = 'accepted'
           AND post.audience = 'public'
           AND post.moderated_at IS NULL
           AND post.identity_mode = 'account'
         ORDER BY link.created_at DESC
         LIMIT ?`,
      )
      .bind(profile.id, limit),
  ]);

  return buildHubProfileGraphProjection(
    profile,
    follows.results as HubGraphFollowRow[],
    posts.results as HubGraphPostRow[],
    knowledge.results as HubGraphKnowledgeRow[],
  );
}
