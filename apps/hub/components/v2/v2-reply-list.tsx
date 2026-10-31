"use client";

import { useEffect, useState } from "react";

import { V2Post } from "@/components/v2/v2-post";
import {
  POST_REPLY_COUNT_CHANGED_EVENT,
  POST_REPLY_CREATED_EVENT,
  type PostReplyCountChangedEventDetail,
  type PostReplyCreatedEventDetail,
} from "@/lib/post-reply-client";
import type { PostReplyOrder } from "@/lib/post-reply-order";
import type { PostPageTimelinePost } from "@/lib/server/post-page-data";

/*
 * 返信の一覧。既存の post-reply-list.tsx と同じ契約で動く。
 *   - 初回の20件はサーバーが描く。以降は cursor で取り足す（上限50）
 *   - 返信が作られたイベント（v1の欄からでも）で先頭に足す
 *   - 件数はイベントで増減する
 * 並びの切り替えはページ側の ?replies= で、ここは受け取るだけ。
 */

const PAGE_SIZE = 20;

export function V2ReplyList({
  postId,
  order,
  initialReplies,
  initialHasMore,
  initialCount,
  viewerId,
  locale,
  returnTo,
}: {
  postId: string;
  order: PostReplyOrder;
  initialReplies: PostPageTimelinePost[];
  initialHasMore: boolean;
  initialCount: number;
  viewerId: string;
  locale: string;
  returnTo?: string;
}) {
  const ja = locale === "ja";
  const [replies, setReplies] = useState(initialReplies);
  const [count, setCount] = useState(initialCount);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onCreated = (event: Event) => {
      const detail = (event as CustomEvent<PostReplyCreatedEventDetail>).detail;
      if (!detail || detail.postId !== postId) return;
      setReplies((previous) => previous.some((item) => item.id === detail.reply.id)
        ? previous
        : [detail.reply, ...previous]);
      setCount((previous) => previous + 1);
    };
    const onCount = (event: Event) => {
      const detail = (event as CustomEvent<PostReplyCountChangedEventDetail>).detail;
      if (!detail || detail.postId !== postId) return;
      setCount((previous) => Math.max(0, previous + detail.delta));
    };
    window.addEventListener(POST_REPLY_CREATED_EVENT, onCreated);
    window.addEventListener(POST_REPLY_COUNT_CHANGED_EVENT, onCount);
    return () => {
      window.removeEventListener(POST_REPLY_CREATED_EVENT, onCreated);
      window.removeEventListener(POST_REPLY_COUNT_CHANGED_EVENT, onCount);
    };
  }, [postId]);

  const loadMore = async () => {
    if (status === "loading") return;
    setStatus("loading");
    try {
      const params = new URLSearchParams({ postId, order, limit: String(PAGE_SIZE) });
      /*
       * 初回はサーバーが描いた分の続きを取りたい。cursor が無い最初の追加取得は
       * offset で描いた分を飛ばす代わりに、いちど同じ順で取り直して重複を除く。
       * 既存も cursor 無しの初回は offset を使っていた。
       */
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/social/posts/replies?${params.toString()}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as {
        replies: PostPageTimelinePost[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      setReplies((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...payload.replies.filter((item) => !seen.has(item.id))];
      });
      setHasMore(payload.hasMore);
      setCursor(payload.nextCursor);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <section className="v2-replies" aria-label={ja ? "返信" : "Replies"}>
      {count > 0 ? (
        <p className="v2-replies__count">
          {ja ? `${count}件の返信` : `${count} replies`}
        </p>
      ) : null}

      {error ? <p className="v2-error" role="alert">{error}</p> : null}

      {replies.length ? (
        <div className="v2-feed">
          {replies.map((reply) => (
            <V2Post key={reply.id} post={reply} viewerId={viewerId} locale={locale} returnTo={returnTo} onError={setError} />
          ))}
        </div>
      ) : (
        <p className="v2-note">{ja ? "最初の返信を書きましょう" : "Write the first reply"}</p>
      )}

      {hasMore ? (
        <p className="v2-replies__more">
          <button
            type="button"
            className="v2-toggle v2-toggle--text"
            disabled={status === "loading"}
            onClick={() => void loadMore()}
          >
            {status === "loading"
              ? (ja ? "読み込んでいます…" : "Loading…")
              : (ja ? "さらに読み込む" : "Load more")}
          </button>
          {status === "failed" ? (
            <span className="v2-error" role="alert">
              {ja ? "読み込めませんでした。" : "Could not load more."}
            </span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
