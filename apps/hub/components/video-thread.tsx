"use client";

import { FormEvent, useMemo, useState } from "react";

import type { VideoThreadComment } from "@/lib/server/d1-video-thread-comments";

const MOCK_AUTHOR = {
  profileId: "mock-viewer",
  handle: "jkamma",
  displayName: "JKamma",
};

function formatCommentDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function VideoThread({
  videoId,
  initialComments,
  authenticated,
  currentPlaybackSeconds,
  onSeek,
  mockMode = false,
}: {
  videoId: string;
  initialComments: VideoThreadComment[];
  authenticated: boolean;
  currentPlaybackSeconds?: number;
  onSeek?: (seconds: number) => void;
  mockMode?: boolean;
}) {
  const [comments, setComments] = useState(initialComments);
  const [visibleRootCount, setVisibleRootCount] = useState(20);
  const [body, setBody] = useState("");
  const [attachPlaybackTime, setAttachPlaybackTime] = useState(false);
  const [replyTo, setReplyTo] = useState<VideoThreadComment | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const roots = useMemo(() => comments.filter((comment) => !comment.parentCommentId).sort((left, right) => {
    if (typeof left.playbackSeconds !== "number" && typeof right.playbackSeconds !== "number") return 0;
    if (typeof left.playbackSeconds !== "number") return 1;
    if (typeof right.playbackSeconds !== "number") return -1;
    return Math.abs(left.playbackSeconds - (currentPlaybackSeconds ?? 0)) - Math.abs(right.playbackSeconds - (currentPlaybackSeconds ?? 0));
  }), [comments, currentPlaybackSeconds]);
  const repliesByParent = useMemo(() => {
    const result = new Map<string, VideoThreadComment[]>();
    for (const comment of comments) {
      if (!comment.parentCommentId) continue;
      result.set(comment.parentCommentId, [...(result.get(comment.parentCommentId) ?? []), comment]);
    }
    return result;
  }, [comments]);

  function mockComment(text: string, parentCommentId?: string): VideoThreadComment {
    const now = new Date().toISOString();
    return {
      id: `mock-comment-${Date.now()}`,
      videoId,
      parentCommentId,
      body: text,
      playbackSeconds: attachPlaybackTime ? currentPlaybackSeconds : undefined,
      createdAt: now,
      updatedAt: now,
      likeCount: 0,
      likedByViewer: false,
      author: MOCK_AUTHOR,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (mockMode) {
        setComments((current) => [...current, mockComment(text, replyTo?.id)]);
      } else {
        const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/comments`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: text, parentCommentId: replyTo?.id, playbackSeconds: attachPlaybackTime ? currentPlaybackSeconds : undefined }),
        });
        const payload = await response.json().catch(() => null) as {
          comments?: VideoThreadComment[];
          error?: string;
        } | null;
        if (!response.ok || !payload?.comments) {
          throw new Error(payload?.error ?? "コメントを投稿できませんでした。");
        }
        setComments(payload.comments);
      }
      setBody("");
      setAttachPlaybackTime(false);
      setReplyTo(null);
      setMessage("投稿しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "コメントを投稿できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(comment: VideoThreadComment) {
    if (!authenticated || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (mockMode) {
        setComments((current) => current.map((item) => item.id === comment.id ? {
          ...item,
          likedByViewer: !item.likedByViewer,
          likeCount: Math.max(0, item.likeCount + (item.likedByViewer ? -1 : 1)),
        } : item));
      } else {
        const response = await fetch(
          `/api/videos/${encodeURIComponent(videoId)}/comments/${encodeURIComponent(comment.id)}/like`,
          { method: comment.likedByViewer ? "DELETE" : "POST", credentials: "same-origin" },
        );
        const payload = await response.json().catch(() => null) as {
          comments?: VideoThreadComment[];
          error?: string;
        } | null;
        if (!response.ok || !payload?.comments) {
          throw new Error(payload?.error ?? "いいねを更新できませんでした。");
        }
        setComments(payload.comments);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "いいねを更新できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function report(comment: VideoThreadComment) {
    if (!authenticated || busy) return;
    const reason = window.prompt("通報理由を入力してください（300文字以内）");
    if (!reason?.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      if (!mockMode) {
        const response = await fetch(
          `/api/videos/${encodeURIComponent(videoId)}/comments/${encodeURIComponent(comment.id)}/report`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason }),
          },
        );
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? "通報できませんでした。");
      }
      setMessage("コメントを通報しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通報できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  function CommentCard({ comment, reply = false }: { comment: VideoThreadComment; reply?: boolean }) {
    return <article className={`video-thread-comment${reply ? " is-reply" : ""}`}>
      <header>
        <span className="video-thread-comment__avatar" aria-hidden="true">
          {comment.author.avatarUrl ? <img src={comment.author.avatarUrl} alt="" /> : comment.author.displayName.slice(0, 1)}
        </span>
        <div><b>{comment.author.displayName}</b><a href={`/profile/${encodeURIComponent(comment.author.handle)}`}>@{comment.author.handle}</a></div>
        <time dateTime={comment.createdAt}>{formatCommentDate(comment.createdAt)}</time>
      </header>
      <p>{comment.body}</p>
      {typeof comment.playbackSeconds === "number" ? <button type="button" className="video-thread-comment__timestamp" onClick={() => onSeek?.(comment.playbackSeconds!)}>{Math.floor(comment.playbackSeconds / 60)}:{String(comment.playbackSeconds % 60).padStart(2, "0")}</button> : null}
      <footer>
        <button type="button" className={comment.likedByViewer ? "is-active" : ""} aria-pressed={comment.likedByViewer} disabled={!authenticated || busy} onClick={() => void toggleLike(comment)}>
          いいね {comment.likeCount}
        </button>
        {!reply ? <button type="button" disabled={!authenticated || busy} onClick={() => {
          setReplyTo(comment);
          setMessage("");
        }}>返信</button> : null}
        <button type="button" disabled={!authenticated || busy} onClick={() => void report(comment)}>通報</button>
      </footer>
    </article>;
  }

  return <section className="video-thread" aria-labelledby="video-thread-title">
    <header className="video-thread__header">
      <div><small>VIDEO THREAD</small><h2 id="video-thread-title">この動画のスレッド</h2></div>
      <span>{comments.length}件</span>
    </header>

    {authenticated ? <form className="video-thread-form" onSubmit={submit}>
      {replyTo ? <div className="video-thread-form__replying">
        <span>{replyTo.author.displayName}さんへ返信</span>
        <button type="button" onClick={() => setReplyTo(null)}>解除</button>
      </div> : null}
      <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={1000} rows={4} required placeholder="この動画について話す…" />
      <label className="video-thread-form__timestamp"><input type="checkbox" checked={attachPlaybackTime} onChange={(event) => setAttachPlaybackTime(event.target.checked)} /> 現在の再生位置を付ける（{Math.floor((currentPlaybackSeconds ?? 0) / 60)}:{String(Math.floor(currentPlaybackSeconds ?? 0) % 60).padStart(2, "0")}）</label>
      <div><small>{body.length}/1000</small><button type="submit" disabled={busy || !body.trim()}>{busy ? "投稿中…" : replyTo ? "返信する" : "コメントする"}</button></div>
    </form> : <div className="video-thread__login"><span>スレッドへの参加にはログインが必要です。</span><a href="/auth">ログイン</a></div>}
    {message ? <p className="video-thread__message" role="status">{message}</p> : null}

    {roots.length ? <div className="video-thread__list">
      {roots.slice(0, visibleRootCount).map((comment) => <div className="video-thread__branch" key={comment.id}>
        <CommentCard comment={comment} />
        {(repliesByParent.get(comment.id) ?? []).map((reply) => <CommentCard comment={reply} reply key={reply.id} />)}
      </div>)}
      {roots.length > visibleRootCount ? <div className="search-load-more"><button type="button" onClick={() => setVisibleRootCount((count) => Math.min(300, count + 20))}>もっと見る</button><small>{visibleRootCount} / {roots.length}</small></div> : null}
    </div> : <div className="video-thread__empty">まだコメントはありません。最初のコメントを投稿できます。</div>}
  </section>;
}
