import type { ThreadPost } from "@/lib/domain";

export function groupThreadReplies<T extends Pick<ThreadPost, "replyToPostId">>(posts: readonly T[]) {
  const grouped = new Map<string, T[]>();
  for (const post of posts) {
    if (!post.replyToPostId) continue;
    const replies = grouped.get(post.replyToPostId) ?? [];
    replies.push(post);
    grouped.set(post.replyToPostId, replies);
  }
  return grouped;
}

export function threadReplyDestination(post: Pick<ThreadPost, "id" | "threadId" | "no">) {
  return `/threads/${post.threadId}?replies=${encodeURIComponent(post.id)}#post-${post.no}`;
}

export function threadPostDisplayBody(body: string, isReply: boolean): string {
  return isReply ? body.replace(/^>>\d+\s*/, "") : body;
}
