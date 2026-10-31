import type { D1Database } from "@cloudflare/workers-types";

/*
 * おすすめのユーザー（右列）。専用の追跡は持たず、すでに公開されている投稿と
 * いいねの集計だけから選ぶ。
 *   - 直近の公開投稿を created_at の索引で最大 CANDIDATE_POSTS 件だけ読む（OFFSET なし）
 *   - 除外: 自分、フォロー済み、ブロック・ミュート（どちら向きでも）、停止中、リモートの影プロフィール、
 *     フォロワー限定・モデレーション済み・ゲート付きの投稿の書き手
 * 結果は閲覧者ごとに数分だけ isolate 内に持つ。D1 は読んだ行数で課金されるので、
 * 画面の描画のたびには呼ばない（右列が開いて探すタブを見たときだけ）。
 */

export const SUGGESTED_USERS_WINDOW_DAYS = 7;
export const SUGGESTED_USERS_CANDIDATE_POSTS = 300;
export const SUGGESTED_USERS_DEFAULT_LIMIT = 5;
export const SUGGESTED_USERS_CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

export interface SuggestedUser {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export const SUGGESTED_USERS_SQL = `
WITH recent AS (
  SELECT sp.id AS post_id, sp.author_profile_id AS pid
  FROM social_posts sp
  WHERE sp.created_at >= ?1
    AND sp.audience = 'public'
    AND sp.moderated_at IS NULL
    AND sp.identity_mode = 'account'
    AND sp.origin = 'local'
    AND sp.reply_to_post_id IS NULL
    AND sp.author_profile_id IS NOT NULL
    AND sp.author_profile_id <> ?2
    AND NOT EXISTS (
      SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = sp.id
    )
  ORDER BY sp.created_at DESC
  LIMIT ?3
),
scored AS (
  SELECT r.pid AS pid,
    COUNT(*) AS posts,
    SUM((SELECT COUNT(*) FROM reactions x
         WHERE x.target_type = 'social_post' AND x.target_id = r.post_id AND x.kind = 'like')) AS likes
  FROM recent r
  GROUP BY r.pid
)
SELECT p.handle AS handle, p.display_name AS display_name, p.avatar_url AS avatar_url
FROM scored s
JOIN profiles p ON p.id = s.pid
WHERE p.kind = 'local'
  AND NOT EXISTS (
    SELECT 1 FROM follows f WHERE f.follower_profile_id = ?2 AND f.followed_profile_id = p.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM profile_moderation_status m WHERE m.profile_id = p.id AND m.status = 'suspended'
  )
  AND NOT EXISTS (
    SELECT 1 FROM thread_user_controls c
    WHERE (c.owner_profile_id = ?2 AND c.target_profile_id = p.id AND (c.blocked = 1 OR c.muted = 1))
       OR (c.owner_profile_id = p.id AND c.target_profile_id = ?2 AND c.blocked = 1)
  )
ORDER BY (s.likes * 2 + s.posts) DESC, p.handle ASC
LIMIT ?4
`;

export async function listD1SuggestedUsers(
  database: D1Database,
  viewerProfileId: string,
  limit = SUGGESTED_USERS_DEFAULT_LIMIT,
  now = new Date(),
): Promise<SuggestedUser[]> {
  const since = new Date(now.getTime() - SUGGESTED_USERS_WINDOW_DAYS * 86_400_000).toISOString();
  const bounded = Math.max(1, Math.min(10, Math.trunc(limit)));
  const result = await database.prepare(SUGGESTED_USERS_SQL)
    .bind(since, viewerProfileId, SUGGESTED_USERS_CANDIDATE_POSTS, bounded)
    .all<{ handle: string; display_name: string; avatar_url: string | null }>();
  return result.results.map((row) => ({
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
  }));
}

const cache = new Map<string, { at: number; users: SuggestedUser[] }>();

/** isolate 内の短い記憶。閲覧者のIDは鍵にだけ使い、値には入れない。 */
export async function getCachedSuggestedUsers(
  database: D1Database,
  viewerProfileId: string,
  now = Date.now(),
): Promise<SuggestedUser[]> {
  const hit = cache.get(viewerProfileId);
  if (hit && now - hit.at < SUGGESTED_USERS_CACHE_MS) return hit.users;
  const users = await listD1SuggestedUsers(database, viewerProfileId, SUGGESTED_USERS_DEFAULT_LIMIT, new Date(now));
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(viewerProfileId, { at: now, users });
  return users;
}

export function clearSuggestedUsersCache() {
  cache.clear();
}
