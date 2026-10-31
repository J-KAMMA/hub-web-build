import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { EngagementSummary, Profile, SocialPost } from "@/lib/domain";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { countD1VisibleUnreadNotifications } from "@/lib/server/visible-notification-count";
import { countD1VisibleUnreadMessages } from "@/lib/server/visible-message-count";
import { sortPostReplies, type PostReplyOrder } from "@/lib/post-reply-order";
import { buildPostAncestorChain } from "@/lib/post-conversation";

export interface PostPageTimelinePost extends SocialPost {
  avatarUrl?: string;
  replyCount: number;
  repostCount: number;
  quoteRepostCount: number;
  likeCount: number;
  score: number;
  bookmarked: boolean;
  viewerReaction: EngagementSummary["viewerReaction"];
  referenced: { label: string; title: string; body: string; href: string; contextLabel?: string; avatarUrl?: string; avatarLabel?: string } | null;
}

export interface PostPageData {
  authenticated: boolean;
  currentProfileId: string;
  currentProfileDisplayName: string;
  currentProfileAvatarUrl?: string;
  notificationCount: number;
  messageCount: number;
  post: PostPageTimelinePost | undefined;
  ancestors: PostPageTimelinePost[];
  replies: PostPageTimelinePost[];
}

async function getD1PostPageData(postId: string, replyOrder: PostReplyOrder, skipCounts: boolean): Promise<PostPageData> {
  const database = getHubD1();
  const viewer = await getHubViewer();
  return getD1PostPageDataForViewer(database, viewer, postId, replyOrder, { skipCounts });
}

export async function getD1PostPageDataForViewer(
  database: D1Database,
  viewer: Profile | null,
  postId: string,
  replyOrder: PostReplyOrder,
  options: { skipCounts?: boolean } = {},
): Promise<PostPageData> {
  const viewerId = viewer?.id ?? null;
  const ids = await database.prepare(`WITH RECURSIVE ancestors(id, reply_to_post_id, depth) AS (
      SELECT id, reply_to_post_id, 0 FROM social_posts WHERE id = ?
      UNION ALL
      SELECT parent.id, parent.reply_to_post_id, ancestors.depth + 1
      FROM social_posts parent
      JOIN ancestors ON ancestors.reply_to_post_id = parent.id
      WHERE ancestors.depth < 20
    )
    SELECT id FROM ancestors
    UNION
    SELECT id FROM social_posts WHERE reply_to_post_id = ?
    ORDER BY id
    LIMIT 120`)
    .bind(postId, postId)
    .all<{ id: string }>();
  const posts = await listD1TimelinePosts(
    database,
    viewerId,
    undefined,
    120,
    0,
    ids.results.map((row) => row.id),
    null,
    "all",
    undefined,
    "all",
    false,
    null,
    null,
    "detail",
  );
  const post = posts.find((item) => item.id === postId);
  const ancestorState = post ? buildPostAncestorChain(posts, post) : null;
  const [notificationCount, messageCount] = viewer && !options.skipCounts
    ? await Promise.all([
      countD1VisibleUnreadNotifications(database, viewer.id),
      countD1VisibleUnreadMessages(database, viewer.id),
    ])
    : [0, 0];

  return {
    authenticated: Boolean(viewer),
    currentProfileId: viewer?.id ?? "",
    currentProfileDisplayName: viewer?.displayName ?? "",
    currentProfileAvatarUrl: viewer?.avatarUrl,
    notificationCount,
    messageCount,
    post,
    ancestors: ancestorState?.ancestors ?? [],
    replies: sortPostReplies(
      posts.filter((item) => item.replyToPostId === postId),
      replyOrder,
    ),
  };
}

export async function getPostPageData(
  postId: string,
  replyOrder: PostReplyOrder = "recommended",
  options: { skipCounts?: boolean } = {},
): Promise<PostPageData> {
  return getD1PostPageData(postId, replyOrder, options.skipCounts === true);
}
