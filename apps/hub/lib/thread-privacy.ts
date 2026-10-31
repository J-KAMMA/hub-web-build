import type { ThreadPost } from "@/lib/domain";

export function toPublicThreadPost<T extends ThreadPost>(post: T): T {
  const publicPost = post.moderatedAt ? { ...post, body: "" } : { ...post };
  if (!post.isAnonymous) return publicPost;
  return {
    ...publicPost,
    authorProfileId: null,
    displayName: "名無しさん",
    authorHandle: undefined,
    authorAvatarUrl: undefined
  } as T;
}

export function publicThreadAuthorProfileId(post: Pick<ThreadPost, "authorProfileId" | "isAnonymous">): string | null {
  return post.isAnonymous ? null : post.authorProfileId;
}
