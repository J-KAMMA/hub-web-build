import type { D1Database } from "@cloudflare/workers-types";

/*
 * Does this creator have any gated post, article or video? One EXISTS per kind, LIMIT 1.
 * Reads only content_access_gates and ids; no body column. Used for the profile 「鍵つきの作品」 button.
 */
export async function profileHasGatedContent(database: D1Database, profileId: string): Promise<boolean> {
  const row = await database.prepare(`SELECT 1 AS present FROM content_access_gates g
    WHERE (g.target_type = 'post' AND EXISTS (SELECT 1 FROM social_posts s WHERE s.id = g.target_id AND s.author_profile_id = ?))
       OR (g.target_type = 'article' AND EXISTS (SELECT 1 FROM hub_user_articles a WHERE a.id = g.target_id AND a.author_profile_id = ?))
       OR (g.target_type = 'video' AND EXISTS (SELECT 1 FROM external_videos v WHERE v.id = g.target_id AND v.submitted_by_profile_id = ? AND v.provider = 'hub'))
    LIMIT 1`).bind(profileId, profileId, profileId).first<{ present: number }>();
  return Boolean(row);
}
