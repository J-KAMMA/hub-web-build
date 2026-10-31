import type { PostReplyOrder } from "@/lib/post-reply-order";

export type PostReplyCursor = {
  order: PostReplyOrder;
  score: number;
  likeCount: number;
  replyCount: number;
  createdAt: string;
  id: string;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export function encodePostReplyCursor(cursor: PostReplyCursor) {
  return encodeURIComponent(JSON.stringify(cursor));
}

export function decodePostReplyCursor(
  value: string | null | undefined,
  expectedOrder: PostReplyOrder,
): PostReplyCursor | null {
  if (!value || value.length > 1_024) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<PostReplyCursor>;
    if (
      parsed.order !== expectedOrder
      || !Number.isSafeInteger(parsed.score)
      || !Number.isSafeInteger(parsed.likeCount)
      || !Number.isSafeInteger(parsed.replyCount)
      || (parsed.score ?? -1) < 0
      || (parsed.likeCount ?? -1) < 0
      || (parsed.replyCount ?? -1) < 0
      || typeof parsed.createdAt !== "string"
      || !Number.isFinite(new Date(parsed.createdAt).getTime())
      || typeof parsed.id !== "string"
      || !ID_PATTERN.test(parsed.id)
    ) {
      return null;
    }
    return parsed as PostReplyCursor;
  } catch {
    return null;
  }
}
