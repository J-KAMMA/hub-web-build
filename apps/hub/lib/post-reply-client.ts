import type { PostPageTimelinePost } from "@/lib/server/post-page-data";

export const POST_REPLY_CREATED_EVENT = "hub:post-reply-created";
export const POST_REPLY_COUNT_CHANGED_EVENT = "hub:post-reply-count-changed";

export type PostReplyCreatedEventDetail = {
  postId: string;
  reply: PostPageTimelinePost;
};

export type PostReplyCountChangedEventDetail = {
  postId: string;
  delta: -1 | 1;
};

export function publishCreatedPostReply(postId: string, reply: PostPageTimelinePost) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PostReplyCreatedEventDetail>(
    POST_REPLY_CREATED_EVENT,
    { detail: { postId, reply } },
  ));
}

export function publishPostReplyCountChange(postId: string, delta: -1 | 1) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PostReplyCountChangedEventDetail>(
    POST_REPLY_COUNT_CHANGED_EVENT,
    { detail: { postId, delta } },
  ));
}
