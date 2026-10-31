import "server-only";

import type { EngagementSummary, SocialPost } from "@/lib/domain";
import {
  getEngagementSummary,
  getProfileById,
  getRepliesForSocialPost,
  getSocialPostById,
  getThreadPostById
} from "@/lib/mock-data";
import { withSocialPostAuthorView } from "@/lib/server/social-post-view";

export interface ServerTimelinePost extends SocialPost {
  avatarUrl?: string;
  replyCount: number;
  repostCount: number;
  quoteRepostCount: number;
  likeCount: number;
  score: number;
  bookmarked: boolean;
  viewerReaction: EngagementSummary["viewerReaction"];
  referenced: {
    label: string;
    title: string;
    body: string;
    href: string;
    contextLabel?: string;
    avatarUrl?: string;
    avatarLabel?: string;
  } | null;
}

function resolveReferencedContent(post: SocialPost): ServerTimelinePost["referenced"] {
  const targetType = post.quoteOfTargetType ?? post.repostOfTargetType;
  const targetId = post.quoteOfTargetId ?? post.repostOfTargetId;
  if (!targetType || !targetId) return null;
  const label = post.quoteOfTargetId ? "Quote" : "Repost";

  if (targetType === "social_post") {
    const source = getSocialPostById(targetId);
    if (!source) return null;
    const sourceView = withSocialPostAuthorView(source);
    return {
      label,
      title: `${sourceView.displayName}${sourceView.handle ? ` @${sourceView.handle}` : ""}`,
      body: source.body,
      href: `/posts/${source.id}`,
      avatarUrl: sourceView.avatarUrl,
      avatarLabel: sourceView.displayName
    };
  }

  const source = getThreadPostById(targetId);
  if (!source) return null;
  const author = source.authorProfileId ? getProfileById(source.authorProfileId) : undefined;
  return {
    label,
    title: `${source.displayName} #${source.no}`,
    body: source.body,
    href: `/threads/${source.threadId}`,
    avatarUrl: author?.avatarUrl,
    avatarLabel: source.displayName
  };
}

export function decorateSocialTimelinePost(post: SocialPost): ServerTimelinePost {
  const engagement = getEngagementSummary("social_post", post.id);
  return {
    ...withSocialPostAuthorView(post),
    replyCount: getRepliesForSocialPost(post.id).length,
    repostCount: engagement.repostCount,
    quoteRepostCount: engagement.quoteRepostCount,
    likeCount: engagement.likeCount,
    score: engagement.score,
    bookmarked: engagement.bookmarked,
    viewerReaction: engagement.viewerReaction,
    referenced: resolveReferencedContent(post)
  };
}
