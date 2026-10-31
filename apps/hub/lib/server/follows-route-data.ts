import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { createD1SocialNotification } from "@/lib/server/d1-social-notifications";
import { toggleRemoteFollow } from "@/lib/server/federation-outbound";
import { requireNoD1BlockBetween } from "@/lib/server/profile-blocks";

export async function toggleD1FollowRouteData(
  database: D1Database,
  viewerProfileId: string,
  targetProfileId: string,
  active?: boolean,
) {
  if (viewerProfileId === targetProfileId) throw new Error("自分自身はフォローできません。");
  const target = await database.prepare("SELECT id FROM profiles WHERE id = ? LIMIT 1")
    .bind(targetProfileId).first();
  if (!target) throw new Error("プロフィールが見つかりません。");
  await requireNoD1BlockBetween(database, viewerProfileId, targetProfileId);
  // 外部の人（影のプロフィール）は Federation 経由でフォローする。承認されるまで follows には入れない。
  const remote = await database.prepare("SELECT 1 AS remote FROM remote_actor_profiles WHERE profile_id = ? LIMIT 1")
    .bind(targetProfileId).first();
  if (remote) return toggleRemoteFollow(database, viewerProfileId, targetProfileId, active);

  const existing = await database.prepare(`SELECT follower_profile_id FROM follows
    WHERE follower_profile_id = ? AND followed_profile_id = ? LIMIT 1`)
    .bind(viewerProfileId, targetProfileId).first();

  if (active === Boolean(existing)) {
    return {
      followerProfileId: viewerProfileId,
      followedProfileId: targetProfileId,
      following: Boolean(existing),
    };
  }

  if (existing) {
    await database.batch([
      database.prepare("DELETE FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ?")
        .bind(viewerProfileId, targetProfileId),
      database.prepare(`DELETE FROM notifications
        WHERE receiver_profile_id = ?
          AND actor_profile_id = ?
          AND notification_type = 'followed'
          AND target_type = 'profile'
          AND target_id = ?
          AND is_read = 0`)
        .bind(targetProfileId, viewerProfileId, viewerProfileId),
    ]);
    return { followerProfileId: viewerProfileId, followedProfileId: targetProfileId, following: false };
  }

  const now = new Date().toISOString();
  await database.prepare(`INSERT OR IGNORE INTO follows (follower_profile_id, followed_profile_id, created_at)
    VALUES (?, ?, ?)`).bind(viewerProfileId, targetProfileId, now).run();

  await createD1SocialNotification(database, {
    receiverProfileId: targetProfileId,
    actorProfileId: viewerProfileId,
    type: "followed",
    targetType: "profile",
    targetId: viewerProfileId,
    text: "新しくフォローされました。",
    preference: "follows",
    createdAt: now,
  });

  return { followerProfileId: viewerProfileId, followedProfileId: targetProfileId, following: true };
}
