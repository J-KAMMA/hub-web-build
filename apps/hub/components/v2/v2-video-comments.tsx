"use client";

import Link from "next/link";
import { useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import type { VideoThreadComment } from "@/lib/server/d1-video-thread-comments";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";

/*
 * 動画の下のコメント。既存の video-thread.tsx から機能だけ抜いた。
 * 一覧は頁で取って渡す。投稿・いいね・通報はAPIが一覧ごと返すので、
 * 返ってきたものでそのまま置き換える（楽観的な差し込みはしない）。
 *
 * 落とさなかったもの: 1000字、返信は1段だけ、いいね、通報、未ログインは閲覧のみ。
 * まだ無いもの: 再生位置つきのコメント（playbackSeconds）、編集・削除。
 */

const MAX = 1000;
const REASONS: { value: string; ja: string; en: string }[] = [
  { value: "spam", ja: "スパム", en: "Spam" },
  { value: "harassment", ja: "嫌がらせ", en: "Harassment" },
  { value: "other", ja: "その他", en: "Other" },
];

export function V2VideoComments({
  videoId,
  initialComments,
  authenticated,
  locale,
  readOnly = false,
}: {
  videoId: string;
  initialComments: VideoThreadComment[];
  authenticated: boolean;
  locale: string;
  /** 新規コメントを受けず、既存のコメントだけを見せる。 */
  readOnly?: boolean;
}) {
  const ja = locale === "ja";
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<VideoThreadComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/videos/${encodeURIComponent(videoId)}/comments`;

  const call = async (url: string, method: string, body?: unknown) => {
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({})) as { comments?: VideoThreadComment[]; error?: string; message?: string };
    if (!response.ok) throw new Error(payload.error || String(response.status));
    return payload;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || body.length > MAX || busy) return;
    setBusy(true);
    try {
      const payload = await call(base, "POST", { body, parentCommentId: replyTo?.id });
      if (payload.comments) setComments(payload.comments);
      setDraft("");
      setReplyTo(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : (ja ? "投稿できませんでした。" : "Could not post."));
    } finally {
      setBusy(false);
    }
  };

  const like = async (comment: VideoThreadComment) => {
    if (!authenticated) return;
    try {
      const payload = await call(`${base}/${encodeURIComponent(comment.id)}/like`, comment.likedByViewer ? "DELETE" : "POST");
      if (payload.comments) setComments(payload.comments);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : (ja ? "反映できませんでした。" : "That did not go through."));
    }
  };

  const report = async (comment: VideoThreadComment, reason: string) => {
    if (!reason) return;
    try {
      await call(`${base}/${encodeURIComponent(comment.id)}/report`, "POST", { reason });
      setError(ja ? "通報を受け付けました。" : "Report received.");
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : (ja ? "通報を送れませんでした。" : "Could not report."));
    }
  };

  const roots = comments.filter((comment) => !comment.parentCommentId);
  const repliesOf = (id: string) => comments.filter((comment) => comment.parentCommentId === id);

  const render = (comment: VideoThreadComment, depth: number) => (
    <li key={comment.id} className={depth ? "v2-vcomment v2-vcomment--reply" : "v2-vcomment"}>
      {comment.author.avatarUrl
        ? <img className="v2-post__avatar" src={comment.author.avatarUrl} alt="" width={44} height={44} />
        : <span className="v2-post__avatar" aria-hidden="true" />}
      <div className="v2-post__body">
        <header className="v2-post__header">
          <Link className="v2-post__name" href={`/v2/profile/${comment.author.handle}`}>{comment.author.displayName}</Link>
          <span className="v2-post__handle">@{comment.author.handle}</span>
          <span className="v2-post__time"><V2RelativeTime value={comment.createdAt} locale={locale} /></span>
        </header>
        <p className="v2-post__text">{comment.body}</p>
        <div className="v2-post__actions">
          <V2Button icon="heart" label={ja ? "いいね" : "Like"} count={comment.likeCount || undefined} pressed={comment.likedByViewer} disabled={!authenticated} onClick={() => void like(comment)} />
          {authenticated && !readOnly && depth === 0 ? <V2Button icon="reply" label={ja ? "返信" : "Reply"} onClick={() => { setReplyTo(comment); document.getElementById("v2-video-comment")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} /> : null}
          {authenticated ? (
            <select className="v2-action v2-action--select" aria-label={ja ? "通報" : "Report"} defaultValue="" onChange={(event) => { void report(comment, event.target.value); event.target.value = ""; }}>
              <option value="">{ja ? "通報…" : "Report…"}</option>
              {REASONS.map((item) => <option key={item.value} value={item.value}>{ja ? item.ja : item.en}</option>)}
            </select>
          ) : null}
        </div>
        {depth === 0 && repliesOf(comment.id).length ? (
          <ul className="v2-vcomments v2-vcomments--nested">
            {repliesOf(comment.id).map((reply) => render(reply, 1))}
          </ul>
        ) : null}
      </div>
    </li>
  );

  return (
    <section className="v2-vthread" aria-label={readOnly ? (ja ? "以前のコメント" : "Earlier comments") : (ja ? "コメント" : "Comments")}>
      {readOnly ? null : <V2SectionTitle>{ja ? `コメント ${comments.length}` : `Comments ${comments.length}`}</V2SectionTitle>}
      {error ? <p className="v2-error" role="status">{error}</p> : null}
      {roots.length ? <ul className="v2-vcomments">{roots.map((comment) => render(comment, 0))}</ul> : <p className="v2-note">{ja ? "まだコメントはありません。" : "No comments yet."}</p>}
      {readOnly ? null : authenticated ? (
        <form id="v2-video-comment" className="v2-reply v2-reply--plain" onSubmit={(event) => void submit(event)}>
          {replyTo ? (
            <p className="v2-note">
              {ja ? "返信先" : "Replying to"} {replyTo.author.displayName}: {replyTo.body.slice(0, 60)}{" "}
              <button type="button" className="v2-card__link" onClick={() => setReplyTo(null)}>{ja ? "解除" : "Clear"}</button>
            </p>
          ) : null}
          <textarea className="v2-reply__input" value={draft} maxLength={MAX} rows={3} placeholder={ja ? "コメントを書く" : "Write a comment"} aria-label={ja ? "コメント" : "Comment"} onChange={(event) => setDraft(event.target.value)} />
          <div className="v2-reply__footer">
            <span className="v2-reply__remaining" aria-live="polite">{MAX - draft.length}</span>
            <button type="submit" className="v2-reply__submit" disabled={busy || !draft.trim()}>{ja ? "送る" : "Post"}</button>
          </div>
        </form>
      ) : (
        <p className="v2-note v2-reply-auth"><Link href="/v2/auth">{ja ? "ログイン" : "Sign in"}</Link>{ja ? "するとコメントできます。" : " to comment."}</p>
      )}
    </section>
  );
}

function V2SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="v2-column__title v2-column__title--section">{children}</h2>;
}
