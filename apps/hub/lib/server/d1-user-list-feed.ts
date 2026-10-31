import type { D1Database } from "@cloudflare/workers-types";

import type { EngagementSummary } from "@/lib/domain";
import type { TimelineCursor } from "@/lib/timeline-cursor";
import { getD1ThreadPostEngagementSummaries } from "@/lib/server/d1-engagements";
import { listD1TimelinePosts, type D1TimelinePost } from "@/lib/server/d1-social-posts";
import { getD1VisibleThreadPostsByIds } from "@/lib/server/d1-threads";
import { redactGated } from "@/lib/server/gated-content";

export type D1UserListFeedItem =
  | { kind: "social"; createdAt: string; post: D1TimelinePost }
  | {
      kind: "thread-response";
      createdAt: string;
      response: {
        id: string;
        threadId: string;
        threadTitle: string;
        no: number;
        authorProfileId: string | null;
        displayName: string;
        authorHandle?: string;
        authorAvatarUrl?: string;
        body: string;
        replyToPostId: string | null;
        createdAt: string;
        isAnonymous: boolean;
        engagement: EngagementSummary;
      };
    };

type FeedKeyRow = {
  kind: "social" | "thread";
  id: string;
  created_at: string;
  item_key: string;
};

export async function listD1UserListFeed(
  database: D1Database,
  viewerProfileId: string,
  listId: string,
  limit = 20,
  cursor?: TimelineCursor | null,
): Promise<D1UserListFeedItem[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const result = await database.prepare(`
    SELECT kind, id, created_at, item_key
    FROM (
      SELECT
        'social' AS kind,
        post.id,
        post.created_at,
        'social_' || post.id AS item_key
      FROM social_posts post
      JOIN list_profiles member ON member.profile_id = post.author_profile_id
      JOIN user_lists own_list ON own_list.id = member.list_id
      WHERE own_list.id = ?
        AND own_list.owner_profile_id = ?
        AND post.moderated_at IS NULL
        AND (
          post.audience = 'public'
          OR post.author_profile_id = ?
          OR (
            post.audience = 'followers'
            AND EXISTS (
              SELECT 1 FROM follows audience_follow
              WHERE audience_follow.follower_profile_id = ?
                AND audience_follow.followed_profile_id = post.author_profile_id
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM profile_moderation_status moderation
          WHERE moderation.profile_id = post.author_profile_id
            AND moderation.status = 'suspended'
        )
        AND NOT EXISTS (
          SELECT 1 FROM thread_user_controls control
          WHERE control.owner_profile_id = ?
            AND control.target_profile_id = post.author_profile_id
            AND (control.muted = 1 OR control.blocked = 1)
        )
        AND NOT EXISTS (
          SELECT 1 FROM thread_user_controls incoming_block
          WHERE incoming_block.owner_profile_id = post.author_profile_id
            AND incoming_block.target_profile_id = ?
            AND incoming_block.blocked = 1
        )
      UNION ALL
      SELECT
        'thread' AS kind,
        reply.id,
        reply.created_at,
        'thread_' || reply.id AS item_key
      FROM thread_posts reply
      JOIN threads thread ON thread.id = reply.thread_id
      JOIN list_threads member ON member.thread_id = reply.thread_id
      JOIN user_lists own_list ON own_list.id = member.list_id
      WHERE own_list.id = ?
        AND own_list.owner_profile_id = ?
        AND reply.post_no > 1
        AND reply.is_anonymous = 0
        AND reply.deleted_at IS NULL
        AND reply.moderated_at IS NULL
        AND thread.status <> 'archived'
        AND (
          reply.author_profile_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM profile_moderation_status moderation
            WHERE moderation.profile_id = reply.author_profile_id
              AND moderation.status = 'suspended'
          )
        )
        AND (
          reply.author_profile_id IS NULL
          OR reply.author_profile_id = ?
          OR (
            NOT EXISTS (
              SELECT 1 FROM thread_user_controls control
              WHERE control.owner_profile_id = ?
                AND control.target_profile_id = reply.author_profile_id
                AND (control.muted = 1 OR control.blocked = 1)
            )
            AND NOT EXISTS (
              SELECT 1 FROM thread_user_controls incoming_block
              WHERE incoming_block.owner_profile_id = reply.author_profile_id
                AND incoming_block.target_profile_id = ?
                AND incoming_block.blocked = 1
            )
          )
        )
    ) feed_item
    ${cursor ? `WHERE (
      created_at < ?
      OR (created_at = ? AND item_key < ?)
    )` : ""}
    ORDER BY created_at DESC, item_key DESC
    LIMIT ?
  `).bind(
    listId,
    viewerProfileId,
    viewerProfileId,
    viewerProfileId,
    viewerProfileId,
    viewerProfileId,
    listId,
    viewerProfileId,
    viewerProfileId,
    viewerProfileId,
    viewerProfileId,
    ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
    safeLimit,
  ).all<FeedKeyRow>();

  const keys = result.results ?? [];
  const socialIds = keys.filter((row) => row.kind === "social").map((row) => row.id);
  const threadIds = keys.filter((row) => row.kind === "thread").map((row) => row.id);
  const [socialPosts, threadPosts, threadEngagements, threadTitles] = await Promise.all([
    listD1TimelinePosts(database, viewerProfileId, undefined, safeLimit, 0, socialIds),
    getD1VisibleThreadPostsByIds(database, threadIds, viewerProfileId).then((rows) => redactGated(database, viewerProfileId, rows, "thread", { keyOf: (row: { threadId: string }) => row.threadId })),
    getD1ThreadPostEngagementSummaries(database, threadIds, viewerProfileId),
    threadIds.length === 0
      ? Promise.resolve(new Map<string, string>())
      : database.prepare(`SELECT id, title FROM threads WHERE id IN (
          SELECT DISTINCT thread_id FROM thread_posts WHERE id IN (${threadIds.map(() => "?").join(", ")})
        )`).bind(...threadIds).all<{ id: string; title: string }>()
        .then((rows) => new Map(rows.results.map((row) => [row.id, row.title]))),
  ]);
  const socialById = new Map(socialPosts.map((post) => [post.id, post]));
  const threadById = new Map(threadPosts.map((post) => [post.id, post]));

  return keys.flatMap((key): D1UserListFeedItem[] => {
    if (key.kind === "social") {
      const post = socialById.get(key.id);
      return post ? [{ kind: "social", createdAt: key.created_at, post }] : [];
    }
    const post = threadById.get(key.id);
    const engagement = threadEngagements.get(key.id);
    if (!post || !engagement) return [];
    return [{
      kind: "thread-response",
      createdAt: key.created_at,
      response: {
        ...post,
        replyToPostId: post.replyToPostId ?? null,
        isAnonymous: false,
        threadTitle: threadTitles.get(post.threadId) ?? "スレッド",
        engagement,
      },
    }];
  });
}
