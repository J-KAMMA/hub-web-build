"use client";

import { useRouter } from "next/navigation";
import React, { useRef, useState, useTransition } from "react";

import { ExternalLinkCard } from "@/components/external-link-card";
import { PostActionRow } from "@/components/post-action-row";
import { EngagementSummary } from "@/lib/domain";

interface EngagementBarProps {
  summary: EngagementSummary;
  threadId?: string;
  threadPostNo?: number;
  onReply?: () => void;
  shareHref?: string;
  repostDestination?: "feed";
  disabled?: boolean;
}

export function EngagementBar({ summary, threadId, threadPostNo, onReply, shareHref, repostDestination, disabled = false }: EngagementBarProps) {
  const router = useRouter();
  const [state, setState] = useState(summary);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [repostMenuOpen, setRepostMenuOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteBody, setQuoteBody] = useState("");
  const postRequestIds = useRef(new Map<string, string>());

  const requestIdFor = (key: string) => {
    const existing = postRequestIds.current.get(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    postRequestIds.current.set(key, created);
    return created;
  };

  // Thread reply form state
  const [threadBody, setThreadBody] = useState(threadPostNo ? `>>${threadPostNo}\n` : "");

  // Social reply form state
  const [socialBody, setSocialBody] = useState("");

  const submitReaction = (kind: "like") => {
    if (disabled || isPending) return;
    setError("");
    const previous = state;
    const activating = previous.viewerReaction !== kind;
    setState((current) => ({ ...current, likeCount: Math.max(0, current.likeCount + (activating ? 1 : -1)), score: Math.max(0, current.score + (activating ? 1 : -1)), viewerReaction: activating ? kind : null }));
    startTransition(async () => {
      try {
        const response = await fetch("/api/engagements/reaction", {
          method: activating ? "PUT" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_type: state.targetType, target_id: state.targetId, kind, active: activating })
        });
        const payload = (await response.json().catch(() => ({}))) as { summary?: EngagementSummary; error?: string };
        if (!response.ok || !payload.summary) {
          setState(previous);
          setError(payload.error ?? "評価の更新に失敗しました。");
          return;
        }
        setState(payload.summary);
      } catch {
        setState(previous);
        setError("通信できなかったため、評価を元に戻しました。");
      }
    });
  };

  const submitBookmark = () => {
    if (disabled || isPending) return;
    setError("");
    const previous = state;
    const activating = !previous.bookmarked;
    setState((current) => ({ ...current, bookmarked: activating, score: Math.max(0, current.score + (activating ? 4 : -4)) }));
    startTransition(async () => {
      try {
        const response = await fetch("/api/engagements/bookmark", {
          method: activating ? "PUT" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_type: state.targetType, target_id: state.targetId, active: activating })
        });
        if (!response.ok) {
          setState(previous);
          setError("ブックマーク更新に失敗しました。");
          return;
        }
        const payload = (await response.json()) as { summary: EngagementSummary };
        if (payload.summary) setState(payload.summary);
      } catch {
        setState(previous);
        setError("通信できなかったため、ブックマークを元に戻しました。");
      }
    });
  };

  const submitThreadReply = () => {
    if (!threadBody.trim()) { setError("本文を入力してください。"); return; }
    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/bbs/threads/${threadId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: threadBody.trim(),
          identity_mode: "account",
          reply_to_post_id: state.targetId
        })
      });
      if (!response.ok) { setError("返信レスに失敗しました。"); return; }
      setState((c) => ({ ...c, replyCount: c.replyCount + 1 }));
      setThreadBody(threadPostNo ? `>>${threadPostNo}\n` : "");
      setReplyOpen(false);
      router.refresh();
    });
  };

  const submitSocialReply = () => {
    const requestKey = `social-reply:${state.targetId}:${socialBody.trim()}`;
    const clientRequestId = requestIdFor(requestKey);
    if (!socialBody.trim()) { setError("本文を入力してください。"); return; }
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: socialBody.trim(),
          identity_mode: "account",
          reply_to_post_id: state.targetId,
          client_request_id: clientRequestId
        })
      });
      if (!response.ok) { setError("返信ポストに失敗しました。"); return; }
      postRequestIds.current.delete(requestKey);
      setState((c) => ({ ...c, replyCount: c.replyCount + 1 }));
      setSocialBody("");
      setReplyOpen(false);
      router.refresh();
    });
  };

  const createRepost = (mode: "repost" | "quote", suppliedBody = "") => {
    if (disabled || isPending) return;
    const body = mode === "quote" ? suppliedBody.trim() : "";
    const requestKey = `${mode}:${state.targetType}:${state.targetId}:${body}`;
    const clientRequestId = requestIdFor(requestKey);
    if (mode === "quote" && !body) return;
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          identity_mode: "account",
          repost_of_target_type: mode === "repost" ? state.targetType : null,
          repost_of_target_id: mode === "repost" ? state.targetId : null,
          quote_of_target_type: mode === "quote" ? state.targetType : null,
          quote_of_target_id: mode === "quote" ? state.targetId : null,
          client_request_id: clientRequestId
        })
      });
      const payload = await response.json().catch(() => null) as {
        error?: string | { message?: string };
        post?: { id?: string };
      } | null;
      if (!response.ok) {
        setError(
          (typeof payload?.error === "string" ? payload.error : payload?.error?.message)
          ?? (mode === "quote" ? "引用リポストに失敗しました。" : "リポストに失敗しました。"),
        );
        return;
      }
      postRequestIds.current.delete(requestKey);
      setState((c) => ({
        ...c,
        repostCount: c.repostCount + (mode === "repost" ? 1 : 0),
        quoteRepostCount: c.quoteRepostCount + (mode === "quote" ? 1 : 0),
        viewerRepostId: mode === "repost"
          ? payload?.post?.id ?? c.viewerRepostId ?? null
          : c.viewerRepostId,
      }));
      if (mode === "quote") {
        setQuoteBody("");
        setQuoteOpen(false);
      }
      router.refresh();
    });
  };

  const removeRepost = () => {
    if (disabled || isPending || !state.viewerRepostId) return;
    const previous = state;
    const repostId = state.viewerRepostId;
    setError("");
    setState((current) => ({
      ...current,
      repostCount: Math.max(0, current.repostCount - 1),
      viewerRepostId: null,
    }));
    startTransition(async () => {
      try {
        const response = await fetch(`/api/social/posts/${encodeURIComponent(repostId)}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          setState(previous);
          setError(payload?.error ?? "リポストの取り消しに失敗しました。");
          return;
        }
        router.refresh();
      } catch {
        setState(previous);
        setError("通信できなかったため、リポストを元に戻しました。");
      }
    });
  };

  const isThreadPost = state.targetType === "thread_post";
  const sharesCommunityPostToFeed = state.targetType === "community_message" && repostDestination === "feed";
  const sharePost = async () => {
    const path = shareHref ?? (isThreadPost && threadId
      ? `/threads/${threadId}${threadPostNo ? `#post-${threadPostNo}` : ""}`
      : `/posts/${state.targetId}`);
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) await navigator.share({ url });
      else await navigator.clipboard.writeText(url);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError("共有に失敗しました。");
    }
  };

  return (
    <div className={`engagement-bar${isThreadPost ? " engagement-bar--thread" : ""}`}>
      <PostActionRow
        className="engagement-bar__row"
        reply={<button
          type="button"
          className={`engagement-chip tweet__action${replyOpen ? " engagement-chip--active tweet__action--active" : ""}`}
          disabled={disabled || isPending}
          onClick={() => {
            if (onReply) {
              onReply();
              setRepostMenuOpen(false);
              setQuoteOpen(false);
              return;
            }
            setReplyOpen((open) => !open);
            setRepostMenuOpen(false);
            setQuoteOpen(false);
          }}
          aria-label="返信"
        >
          <span className="tweet__action-icon"><IconReply /></span>
          {state.replyCount > 0 ? <span className="tweet__action-count">{state.replyCount}</span> : null}
        </button>}
        repost={<div className="engagement-bar__repost">
          <button
            type="button"
            className={`engagement-chip tweet__action tweet__action--repost${repostMenuOpen || state.viewerRepostId ? " tweet__action--active" : ""}`}
            disabled={disabled || isPending}
            onClick={() => {
              setRepostMenuOpen((open) => !open);
              setReplyOpen(false);
              setQuoteOpen(false);
            }}
            aria-label={sharesCommunityPostToFeed ? "フィードに共有" : "リポスト"}
            aria-expanded={repostMenuOpen}
            aria-haspopup="menu"
            aria-pressed={Boolean(state.viewerRepostId)}
          >
            <span className="tweet__action-icon"><IconRepost /></span>
            {state.repostCount + state.quoteRepostCount > 0 ? <span className="tweet__action-count">{state.repostCount + state.quoteRepostCount}</span> : null}
          </button>
          {repostMenuOpen && (
            <div className="tweet__repost-menu" role="menu">
              <button type="button" className="tweet__repost-menu-item" onClick={() => {
                setRepostMenuOpen(false);
                if (state.viewerRepostId) removeRepost();
                else createRepost("repost");
              }}>
                <IconRepost /> {state.viewerRepostId
                  ? (sharesCommunityPostToFeed ? "フィードから共有を取り消す" : "リポストを取り消す")
                  : (sharesCommunityPostToFeed ? "フィードに共有" : "リポスト")}
              </button>
              <button type="button" className="tweet__repost-menu-item" onClick={() => { setRepostMenuOpen(false); setQuoteOpen(true); }}>
                {sharesCommunityPostToFeed ? "コメントを付けてフィードに共有" : "引用"}
              </button>
            </div>
          )}
        </div>}
        like={<button
          type="button"
          className={`engagement-chip tweet__action tweet__action--like${state.viewerReaction === "like" ? " engagement-chip--active tweet__action--active" : ""}`}
          disabled={disabled || isPending}
          onClick={() => submitReaction("like")}
          aria-label={state.viewerReaction === "like" ? "いいねを取り消す" : "いいね"}
          aria-pressed={state.viewerReaction === "like"}
        >
          <span className="tweet__action-icon"><IconLike active={state.viewerReaction === "like"} /></span>
          {state.likeCount > 0 ? <span className="tweet__action-count">{state.likeCount}</span> : null}
        </button>}
        bookmark={<button
          type="button"
          className={`engagement-chip tweet__action tweet__action--bookmark${state.bookmarked ? " engagement-chip--active tweet__action--active" : ""}`}
          disabled={disabled || isPending}
          onClick={submitBookmark}
          aria-label={state.bookmarked ? "ブックマークを解除" : "ブックマーク"}
          aria-pressed={state.bookmarked}
        >
          <span className="tweet__action-icon"><IconBookmark active={state.bookmarked} /></span>
        </button>}
        share={<button
          type="button"
          className="engagement-chip tweet__action tweet__action--share"
          disabled={disabled || isPending}
          onClick={() => void sharePost()}
          aria-label="共有"
        >
          <span className="tweet__action-icon"><IconShare /></span>
        </button>}
      />

      {replyOpen && !onReply && isThreadPost && (
        <div className="engagement-bar__composer">
          <textarea
            className="composer__input engagement-bar__textarea"
            placeholder={threadPostNo ? `>>${threadPostNo} への返信レス…` : "返信レスの内容…"}
            value={threadBody}
            onChange={(e) => setThreadBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitThreadReply(); }}
            disabled={isPending}
          />
          <ExternalLinkCard body={threadBody} />
          <div className="engagement-bar__composer-actions">
            <button type="button" className="button" onClick={() => setReplyOpen(false)}>キャンセル</button>
            <button type="button" className="button button--primary" onClick={submitThreadReply} disabled={isPending || !threadBody.trim()}>
              {isPending ? "送信中…" : "返信レスを書き込む"}
            </button>
          </div>
        </div>
      )}

      {replyOpen && !onReply && !isThreadPost && (
        <div className="engagement-bar__composer">
          <textarea
            className="composer__input engagement-bar__textarea"
            placeholder="返信ポストの内容…"
            value={socialBody}
            onChange={(e) => setSocialBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitSocialReply(); }}
            disabled={isPending}
          />
          <ExternalLinkCard body={socialBody} />
          <div className="engagement-bar__composer-actions">
            <button type="button" className="button" onClick={() => setReplyOpen(false)}>キャンセル</button>
            <button type="button" className="button button--primary" onClick={submitSocialReply} disabled={isPending || !socialBody.trim()}>
              {isPending ? "送信中…" : "返信ポストを投稿する"}
            </button>
          </div>
        </div>
      )}

      {quoteOpen && (
        <div className="engagement-bar__composer">
          <div className="tweet__quote engagement-bar__quote-preview">
            <p className="tweet__quote-body">
              {isThreadPost && threadPostNo ? `スレッドの投稿 #${threadPostNo}` : "引用元の投稿"}
            </p>
          </div>
          <textarea
            className="composer__input engagement-bar__textarea"
            placeholder="コメントを追加"
            value={quoteBody}
            onChange={(event) => setQuoteBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) createRepost("quote", quoteBody);
            }}
            disabled={isPending}
            autoFocus
          />
          <ExternalLinkCard body={quoteBody} />
          <div className="engagement-bar__composer-actions">
            <button type="button" className="button" onClick={() => { setQuoteOpen(false); setQuoteBody(""); }}>キャンセル</button>
            <button type="button" className="button button--primary" onClick={() => createRepost("quote", quoteBody)} disabled={isPending || !quoteBody.trim()}>
              {isPending ? "送信中…" : "引用して投稿"}
            </button>
          </div>
        </div>
      )}

      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}

const IconReply = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 7.879 3.77 7.879 8.005 0 4.247-3.375 7.937-7.958 7.937-1.244 0-2.443-.29-3.517-.816l-3.876 1.07a.75.75 0 0 1-.929-.928l1.07-3.876A7.898 7.898 0 0 1 1.751 10Z" />
  </svg>
);

const IconRepost = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="m4.5 3.88 4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88ZM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2Z" />
  </svg>
);

const IconLike = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
  </svg>
);

const IconBookmark = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5ZM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11Z" />
  </svg>
);

const IconShare = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M12 16V3m0 0L7.5 7.5M12 3l4.5 4.5" />
    <path d="M5 12v6.25A2.75 2.75 0 0 0 7.75 21h8.5A2.75 2.75 0 0 0 19 18.25V12" />
  </svg>
);
