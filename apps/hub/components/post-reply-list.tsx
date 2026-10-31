"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";

import { TweetCard } from "@/components/timeline-client";
import { UiButton, UiStatePanel } from "@/components/ui/primitives";
import type { HubLocale } from "@/lib/i18n";
import {
  POST_REPLY_COUNT_CHANGED_EVENT,
  POST_REPLY_CREATED_EVENT,
  publishPostReplyCountChange,
  type PostReplyCountChangedEventDetail,
  type PostReplyCreatedEventDetail,
} from "@/lib/post-reply-client";
import type { PostReplyOrder } from "@/lib/post-reply-order";
import type { PostPageTimelinePost } from "@/lib/server/post-page-data";
import { encodePostReplyCursor } from "@/lib/post-reply-cursor";

type ReplyListState = {
  status: "idle" | "loading" | "failed" | "complete";
  replies: PostPageTimelinePost[];
  hasMore: boolean;
  serverOffset: number;
  nextCursor: string | null;
};

type ReplyListEvent =
  | { type: "load" }
  | { type: "succeeded"; replies: PostPageTimelinePost[]; hasMore: boolean; nextCursor: string | null }
  | { type: "created"; reply: PostPageTimelinePost; order: PostReplyOrder }
  | { type: "deleted"; replyId: string }
  | { type: "failed" };

function reducer(state: ReplyListState, event: ReplyListEvent): ReplyListState {
  if (event.type === "load") {
    if (state.status === "loading" || !state.hasMore) return state;
    return { ...state, status: "loading" };
  }
  if (event.type === "failed") {
    return { ...state, status: "failed" };
  }
  if (event.type === "created") {
    if (state.replies.some((reply) => reply.id === event.reply.id)) return state;
    return {
      ...state,
      replies: event.order === "oldest"
        ? [...state.replies, event.reply]
        : [event.reply, ...state.replies],
    };
  }
  if (event.type === "deleted") {
    return { ...state, replies: state.replies.filter((reply) => reply.id !== event.replyId) };
  }
  const known = new Set(state.replies.map((reply) => reply.id));
  const replies = [...state.replies, ...event.replies.filter((reply) => !known.has(reply.id))];
  return {
    status: event.hasMore ? "idle" : "complete",
    replies,
    hasMore: event.hasMore,
    serverOffset: state.serverOffset + event.replies.length,
    nextCursor: event.nextCursor,
  };
}

const SOCIAL_POST_DELETED_EVENT = "hub:social-post-deleted";

export function PostReplyList({
  postId,
  order,
  locale,
  viewerProfileId,
  initialReplies,
  initialHasMore,
}: {
  postId: string;
  order: PostReplyOrder;
  locale: HubLocale;
  viewerProfileId: string;
  initialReplies: PostPageTimelinePost[];
  initialHasMore: boolean;
}) {
  const initialState: ReplyListState = {
    status: initialHasMore ? "idle" : "complete",
    replies: initialReplies,
    hasMore: initialHasMore,
    serverOffset: initialReplies.length,
    nextCursor: initialReplies.length
      ? encodePostReplyCursor({
        order,
        score: initialReplies.at(-1)!.score,
        likeCount: initialReplies.at(-1)!.likeCount,
        replyCount: initialReplies.at(-1)!.replyCount,
        createdAt: initialReplies.at(-1)!.createdAt,
        id: initialReplies.at(-1)!.id,
      })
      : null,
  };
  const [state, dispatch] = useReducer(reducer, initialState);
  const knownReplyIds = useRef(new Set(initialReplies.map((reply) => reply.id)));

  useEffect(() => {
    const addReply = (event: Event) => {
      const detail = (event as CustomEvent<PostReplyCreatedEventDetail>).detail;
      if (detail.postId !== postId || knownReplyIds.current.has(detail.reply.id)) return;
      knownReplyIds.current.add(detail.reply.id);
      dispatch({ type: "created", reply: detail.reply, order });
      publishPostReplyCountChange(postId, 1);
    };
    const removeReply = (event: Event) => {
      const replyId = (event as CustomEvent<string>).detail;
      if (!knownReplyIds.current.delete(replyId)) return;
      dispatch({ type: "deleted", replyId });
      publishPostReplyCountChange(postId, -1);
    };
    window.addEventListener(POST_REPLY_CREATED_EVENT, addReply);
    window.addEventListener(SOCIAL_POST_DELETED_EVENT, removeReply);
    return () => {
      window.removeEventListener(POST_REPLY_CREATED_EVENT, addReply);
      window.removeEventListener(SOCIAL_POST_DELETED_EVENT, removeReply);
    };
  }, [order, postId]);

  const loadMore = async () => {
    if (state.status === "loading" || !state.hasMore) return;
    dispatch({ type: "load" });
    try {
      const query = new URLSearchParams({
        postId,
        order,
        limit: "20",
      });
      if (state.nextCursor) query.set("cursor", state.nextCursor);
      else query.set("offset", String(state.serverOffset));
      const response = await fetch(`/api/social/posts/replies?${query.toString()}`, {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null) as {
        replies?: PostPageTimelinePost[];
        hasMore?: boolean;
        nextCursor?: string | null;
      } | null;
      if (!response.ok || !Array.isArray(payload?.replies)) {
        dispatch({ type: "failed" });
        return;
      }
      dispatch({
        type: "succeeded",
        replies: payload.replies,
        hasMore: payload.hasMore === true,
        nextCursor: payload.nextCursor ?? null,
      });
    } catch {
      dispatch({ type: "failed" });
    }
  };

  return (
    <>
      <div className="post-detail__reply-list">
        {state.replies.map((reply) => (
          <TweetCard key={reply.id} post={reply} locale={locale} viewerProfileId={viewerProfileId} />
        ))}
      </div>
      {state.replies.length === 0 ? (
        <UiStatePanel className="post-detail__empty" state="empty" title="まだ返信はありません" description="最初の返信を投稿して、会話を始めましょう。" />
      ) : null}
      {state.hasMore ? (
        <div className="post-detail__load-more">
          <UiButton type="button" pending={state.status === "loading"} pendingLabel="読み込み中…" onClick={() => void loadMore()}>
            {state.status === "failed" ? "再試行" : "返信をさらに表示"}
          </UiButton>
          {state.status === "failed" ? (
            <span role="alert">返信を読み込めませんでした。接続を確認して再試行してください。</span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function PostReplyCount({ postId, initialCount }: { postId: string; initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const updateCount = (event: Event) => {
      const detail = (event as CustomEvent<PostReplyCountChangedEventDetail>).detail;
      if (detail.postId !== postId) return;
      setCount((current) => Math.max(0, current + detail.delta));
    };
    window.addEventListener(POST_REPLY_COUNT_CHANGED_EVENT, updateCount);
    return () => window.removeEventListener(POST_REPLY_COUNT_CHANGED_EVENT, updateCount);
  }, [postId]);

  return <span className="post-detail__reply-count">{count}</span>;
}
