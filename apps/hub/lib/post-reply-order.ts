export type PostReplyOrder = "recommended" | "latest" | "oldest";

type OrderableReply = {
  id: string;
  createdAt: string;
  score: number;
  likeCount: number;
  replyCount: number;
};

export function normalizePostReplyOrder(value: string | string[] | undefined): PostReplyOrder {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "latest" || candidate === "oldest" ? candidate : "recommended";
}

export function sortPostReplies<T extends OrderableReply>(
  replies: T[],
  order: PostReplyOrder,
): T[] {
  return [...replies].sort((left, right) => {
    if (order === "latest") {
      return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
    }
    if (order === "oldest") {
      return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
    }
    return (
      right.score - left.score
      || right.likeCount - left.likeCount
      || right.replyCount - left.replyCount
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    );
  });
}
