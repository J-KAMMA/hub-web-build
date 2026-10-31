import type { D1Database } from "@cloudflare/workers-types";

import type { EngagementTargetType } from "@/lib/domain";

export type VisibleSocialTarget = {
  id: string;
  authorProfileId: string | null;
};

export async function findVisibleD1SocialTarget(
  database: D1Database,
  viewerProfileId: string | null,
  targetType: EngagementTargetType,
  targetId: string,
): Promise<VisibleSocialTarget | null> {
  const viewerId = viewerProfileId ?? "";
  if (targetType === "vault_content") {
    return targetId.length > 0 && targetId.length <= 200
      ? { id: targetId, authorProfileId: null }
      : null;
  }
  if (targetType === "social_post") {
    return database.prepare(`SELECT post.id,
      post.author_profile_id AS authorProfileId
      FROM social_posts post
      WHERE post.id = ? AND post.moderated_at IS NULL
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
      LIMIT 1`)
      .bind(targetId, viewerId, viewerId)
      .first<VisibleSocialTarget>();
  }
  if (targetType === "thread_post") {
    return database.prepare(`SELECT post.id,
      post.author_profile_id AS authorProfileId
      FROM thread_posts post
      WHERE post.id = ? AND post.deleted_at IS NULL
        AND post.moderated_at IS NULL
      LIMIT 1`)
      .bind(targetId)
      .first<VisibleSocialTarget>();
  }
  return database.prepare(`SELECT message.id,
    message.author_profile_id AS authorProfileId
    FROM community_channel_messages message
    JOIN community_channels channel ON channel.id = message.channel_id
    JOIN communities community ON community.id = channel.community_id
    WHERE message.id = ?
      AND community.lifecycle_status = 'active'
      AND (
        community.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM community_memberships membership
          WHERE membership.community_id = community.id
            AND membership.profile_id = ?
            AND membership.status <> 'banned'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_member_custom_roles member_role
        JOIN community_channel_permissions permission
          ON permission.role_id = member_role.role_id
        WHERE member_role.community_id = community.id
          AND member_role.profile_id = ?
          AND permission.channel_id = channel.id
        GROUP BY permission.channel_id
        HAVING MIN(permission.can_view) = 0
      )
    LIMIT 1`)
    .bind(targetId, viewerId, viewerId)
    .first<VisibleSocialTarget>();
}
