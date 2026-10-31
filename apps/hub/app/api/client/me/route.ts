import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { countD1UnreadNotifications } from "@/lib/server/d1-notifications";
import { countD1UnreadDirectMessages } from "@/lib/server/d1-direct-messages";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { toClientPost } from "@/lib/client-feed-shape";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアントが起動時に聞く「自分は誰で、何が溜まっているか」。
 * 端末側のアカウント表示と未読バッジはここ1発で組み立てられるようにする。
 * posts はプロフィール画面用の自分の投稿（組み立ては画面と同じ関数）。
 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    /* ?posts=0 は「誰か」と未読数だけ欲しい呼び出し（タイムライン・未読バッジ）。投稿50件を読まない。 */
    const withPosts = new URL(request.url).searchParams.get("posts") !== "0";
    const [unreadNotifications, unreadMessages, ownPosts, stats] = await Promise.all([
      countD1UnreadNotifications(database, profile.id, { excludeMessageReceived: true }),
      countD1UnreadDirectMessages(database, profile.id),
      withPosts ? listD1TimelinePosts(database, profile.id, profile.id, 50) : Promise.resolve([]),
      database
        .prepare(
          `SELECT
             (SELECT count(*) FROM follows f WHERE f.followed_profile_id = ?) AS follower_count,
             (SELECT count(*) FROM follows f WHERE f.follower_profile_id = ?) AS following_count,
             (SELECT count(*) FROM social_posts s
              WHERE s.author_profile_id = ? AND s.moderated_at IS NULL
                AND s.reply_to_post_id IS NULL AND s.repost_of_target_id IS NULL) AS post_count`,
        )
        .bind(profile.id, profile.id, profile.id)
        .first<{ follower_count: number; following_count: number; post_count: number }>(),
    ]);
    return NextResponse.json(
      {
        profile: {
          id: profile.id,
          handle: profile.handle,
          displayName: profile.displayName,
          bio: profile.bio,
          avatarUrl: profile.avatarUrl ?? null,
          joinedAt: profile.joinedAt,
        },
        unreadNotifications,
        unreadMessages,
        posts: ownPosts.map((post) => toClientPost(post)),
        stats: {
          followerCount: Number(stats?.follower_count ?? 0),
          followingCount: Number(stats?.following_count ?? 0),
          postCount: Number(stats?.post_count ?? 0),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    throw error;
  }
}
