type ConversationPost = {
  id: string;
  replyToPostId: string | null;
};

export type PostAncestorChain<T> = {
  ancestors: T[];
  missingParentId: string | null;
  cycleDetected: boolean;
};

export function buildPostAncestorChain<T extends ConversationPost>(
  posts: T[],
  post: T,
  maximumDepth = 20,
): PostAncestorChain<T> {
  const byId = new Map(posts.map((item) => [item.id, item]));
  const seen = new Set([post.id]);
  const nearestFirst: T[] = [];
  let parentId = post.replyToPostId;
  let missingParentId: string | null = null;
  let cycleDetected = false;

  while (parentId && nearestFirst.length < maximumDepth) {
    if (seen.has(parentId)) {
      cycleDetected = true;
      break;
    }
    const parent = byId.get(parentId);
    if (!parent) {
      missingParentId = parentId;
      break;
    }
    seen.add(parent.id);
    nearestFirst.push(parent);
    parentId = parent.replyToPostId;
  }

  return {
    ancestors: nearestFirst.reverse(),
    missingParentId,
    cycleDetected,
  };
}
