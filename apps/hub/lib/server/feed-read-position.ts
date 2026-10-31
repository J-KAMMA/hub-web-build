import type { D1Database } from "@cloudflare/workers-types";

import type { FeedReadPositionInput } from "@/lib/feed-read-position";

export async function canStoreFeedReadPosition(
  database: D1Database,
  profileId: string,
  input: FeedReadPositionInput,
) {
  if (input.listId && input.itemType === "thread") {
    return Boolean(await database.prepare(`
      SELECT tp.id
      FROM thread_posts tp
      JOIN list_threads lt ON lt.thread_id = tp.thread_id
      JOIN user_lists ul ON ul.id = lt.list_id
      WHERE tp.id = ? AND ul.id = ? AND ul.owner_profile_id = ?
      LIMIT 1
    `).bind(input.sourceItemId, input.listId, profileId).first<{ id: string }>());
  }

  if (input.listId) {
    return Boolean(await database.prepare(`
      SELECT sp.id
      FROM social_posts sp
      JOIN list_profiles lp ON lp.profile_id = sp.author_profile_id
      JOIN user_lists ul ON ul.id = lp.list_id
      WHERE sp.id = ? AND ul.id = ? AND ul.owner_profile_id = ?
        AND (
          sp.audience = 'public'
          OR sp.author_profile_id = ?
          OR (
            sp.audience = 'followers'
            AND EXISTS (
              SELECT 1 FROM follows f
              WHERE f.follower_profile_id = ? AND f.followed_profile_id = sp.author_profile_id
            )
          )
        )
      LIMIT 1
    `).bind(input.sourceItemId, input.listId, profileId, profileId, profileId).first<{ id: string }>());
  }

  const followingOnly = input.view === "following"
    ? `AND (
        sp.author_profile_id = ?
        OR EXISTS (
          SELECT 1 FROM follows own_feed
          WHERE own_feed.follower_profile_id = ? AND own_feed.followed_profile_id = sp.author_profile_id
        )
      )`
    : "";
  const bindings = input.view === "following"
    ? [input.sourceItemId, profileId, profileId, profileId, profileId]
    : [input.sourceItemId, profileId, profileId];
  return Boolean(await database.prepare(`
    SELECT sp.id
    FROM social_posts sp
    WHERE sp.id = ?
      AND (
        sp.audience = 'public'
        OR sp.author_profile_id = ?
        OR (
          sp.audience = 'followers'
          AND EXISTS (
            SELECT 1 FROM follows f
            WHERE f.follower_profile_id = ? AND f.followed_profile_id = sp.author_profile_id
          )
        )
      )
      ${followingOnly}
    LIMIT 1
  `).bind(...bindings).first<{ id: string }>());
}
