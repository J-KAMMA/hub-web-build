import type { D1Database } from "@cloudflare/workers-types";

const mockPinnedPosts = new Map<string, string>();

export async function getD1PinnedProfilePostId(
  database: D1Database,
  profileId: string,
): Promise<string | null> {
  try {
    const row = await database.prepare(
      "SELECT post_id FROM profile_pinned_posts WHERE profile_id = ? LIMIT 1",
    ).bind(profileId).first<{ post_id: string }>();
    return row?.post_id ?? null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) return null;
    throw error;
  }
}

export async function setD1PinnedProfilePost(
  database: D1Database,
  profileId: string,
  postId: string | null,
): Promise<string | null> {
  if (!postId) {
    await database.prepare("DELETE FROM profile_pinned_posts WHERE profile_id = ?")
      .bind(profileId).run();
    return null;
  }

  const owned = await database.prepare(`SELECT id FROM social_posts
    WHERE id = ? AND author_profile_id = ? AND identity_mode = 'account'
      AND reply_to_post_id IS NULL LIMIT 1`)
    .bind(postId, profileId).first<{ id: string }>();
  if (!owned) throw new Error("自分の公開ポストだけを固定できます。");

  await database.prepare(`INSERT INTO profile_pinned_posts (profile_id, post_id, pinned_at)
    VALUES (?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET post_id = excluded.post_id, pinned_at = excluded.pinned_at`)
    .bind(profileId, postId, new Date().toISOString()).run();
  return postId;
}

export function getMockPinnedProfilePostId(profileId: string): string | null {
  return mockPinnedPosts.get(profileId) ?? null;
}

export function setMockPinnedProfilePost(profileId: string, postId: string | null): string | null {
  if (postId) mockPinnedPosts.set(profileId, postId);
  else mockPinnedPosts.delete(profileId);
  return postId;
}
