"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";
import type { ArticleComment, ArticleEngagementState } from "@/lib/server/d1-user-article-engagement";

import "../../app/v2/v2-article-engagement.css";

/*
 * 記事のいいねとコメント（レーンD）。読む画面の末尾に置く。
 * 色は意味トークンだけ（app/v2/v2-article-engagement.css）。
 * いいねの数は誰にでも見せる。コメントは古い順で、続きは「さらに読む」で足す。
 * 返信は1段まで（返信への返信は最上位コメントの下に付く）。4件目以降は折りたたむ。
 * コメントにもいいねを付けられる。書き手は1件だけピン留めでき、先頭に「ピン留め」で出る。
 * 削除された親コメントは、返信が残るあいだ「削除されたコメント」として位置を保つ。
 */

const MAX_LENGTH = 2000;
const REPLIES_SHOWN = 3;

type Props = {
  articleId: string;
  initial: ArticleEngagementState;
  authenticated: boolean;
  locale: string;
};

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === "string" && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/** 最上位コメントとその返信のすべてに手を入れる。 */
function mapAll(list: ArticleComment[], fn: (comment: ArticleComment) => ArticleComment): ArticleComment[] {
  return list.map((comment) => {
    const next = fn(comment);
    return next.replies.length ? { ...next, replies: next.replies.map(fn) } : next;
  });
}

export function V2ArticleEngagement({ articleId, initial, authenticated, locale }: Props) {
  const ja = locale === "ja";
  const base = `/api/articles/${encodeURIComponent(articleId)}`;
  const signIn = `/v2/auth?next=${encodeURIComponent(`/v2/articles/${articleId}`)}`;
  const isAuthor = initial.isAuthor;

  const [liked, setLiked] = useState(initial.liked);
  const [likeCount, setLikeCount] = useState(initial.likeCount);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);

  const [comments, setComments] = useState<ArticleComment[]>(initial.comments.comments);
  const [total, setTotal] = useState(initial.comments.total);
  const [cursor, setCursor] = useState<string | null>(initial.comments.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reportNote, setReportNote] = useState<{ id: string; message: string; ok: boolean } | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyPosting, setReplyPosting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pinBusy, setPinBusy] = useState(false);
  const [likeBusyIds, setLikeBusyIds] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(false);

  const toggleLike = useCallback(async () => {
    if (likeBusy || busyRef.current) return;
    busyRef.current = true;
    setLikeBusy(true);
    setLikeError(null);
    const next = !liked;
    try {
      const response = await fetch(`${base}/like`, { method: next ? "PUT" : "DELETE", headers: { accept: "application/json" } });
      if (!response.ok) { setLikeError(await readError(response, ja ? "いいねできませんでした。" : "Could not update the like.")); return; }
      const state = await response.json() as { liked: boolean; likeCount: number };
      setLiked(state.liked);
      setLikeCount(state.likeCount);
    } catch {
      setLikeError(ja ? "通信できませんでした。" : "Network error.");
    } finally {
      busyRef.current = false;
      setLikeBusy(false);
    }
  }, [base, ja, liked, likeBusy]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      const response = await fetch(`${base}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!response.ok) { setPostError(await readError(response, ja ? "コメントを投稿できませんでした。" : "Could not post the comment.")); return; }
      const created = await response.json() as { comment: ArticleComment };
      /* 続きのページがあるときは末尾にまだ着いていないので、自分の分は足さず件数だけ増やす。 */
      if (!cursor) setComments((current) => [...current, created.comment]);
      setTotal((count) => count + 1);
      setDraft("");
    } catch {
      setPostError(ja ? "通信できませんでした。" : "Network error.");
    } finally {
      setPosting(false);
    }
  };

  const submitReply = async (target: ArticleComment) => {
    const body = replyDraft.trim();
    if (!body || replyPosting) return;
    setReplyPosting(true);
    setReplyError(null);
    try {
      const response = await fetch(`${base}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ body, parentId: target.id }),
      });
      if (!response.ok) { setReplyError(await readError(response, ja ? "返信を投稿できませんでした。" : "Could not post the reply.")); return; }
      const created = await response.json() as { comment: ArticleComment };
      const rootId = created.comment.parentId ?? target.id;
      setComments((current) => current.map((root) => root.id === rootId ? { ...root, replies: [...root.replies, created.comment] } : root));
      setExpanded((current) => new Set(current).add(rootId));
      setTotal((count) => count + 1);
      setReplyDraft("");
      setReplyTo(null);
    } catch {
      setReplyError(ja ? "通信できませんでした。" : "Network error.");
    } finally {
      setReplyPosting(false);
    }
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setListError(null);
    try {
      const response = await fetch(`${base}/comments?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      if (!response.ok) { setListError(await readError(response, ja ? "続きを読み込めませんでした。" : "Could not load more.")); return; }
      const page = await response.json() as { comments: ArticleComment[]; nextCursor: string | null; total: number };
      setComments((current) => {
        const seen = new Set(current.map((comment) => comment.id));
        return [...current, ...page.comments.filter((comment) => !seen.has(comment.id))];
      });
      setCursor(page.nextCursor);
      setTotal(page.total);
    } catch {
      setListError(ja ? "通信できませんでした。" : "Network error.");
    } finally {
      setLoadingMore(false);
    }
  };

  const remove = async (comment: ArticleComment) => {
    if (!window.confirm(ja ? "このコメントを削除します。元には戻せません。" : "Delete this comment? This cannot be undone.")) return;
    try {
      const response = await fetch(`${base}/comments/${encodeURIComponent(comment.id)}`, { method: "DELETE", headers: { accept: "application/json" } });
      if (!response.ok) { setListError(await readError(response, ja ? "削除できませんでした。" : "Could not delete.")); return; }
      setComments((current) => {
        if (comment.parentId) {
          return current.map((root) => root.id === comment.parentId ? { ...root, replies: root.replies.filter((item) => item.id !== comment.id) } : root);
        }
        // 返信が残る親は「削除されたコメント」として位置を保つ。残らないなら消す。
        return current.flatMap((root) => root.id !== comment.id ? [root]
          : root.replies.length
            ? [{ ...root, removed: true, pinned: false, body: "", canDelete: false, mine: false, likeCount: 0, liked: false, author: { id: "", handle: "", displayName: "", avatarUrl: null } }]
            : []);
      });
      setTotal((count) => Math.max(0, count - 1));
    } catch {
      setListError(ja ? "通信できませんでした。" : "Network error.");
    }
  };

  const report = async (comment: ArticleComment) => {
    const text = reason.trim();
    if (!text) return;
    try {
      const response = await fetch(`${base}/comments/${encodeURIComponent(comment.id)}/report`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ reason: text }),
      });
      if (!response.ok) { setReportNote({ id: comment.id, ok: false, message: await readError(response, ja ? "通報できませんでした。" : "Could not report.") }); return; }
      setReportNote({ id: comment.id, ok: true, message: ja ? "通報を受け付けました。運営が確認します。" : "Report received. Moderators will review it." });
      setReporting(null);
      setReason("");
    } catch {
      setReportNote({ id: comment.id, ok: false, message: ja ? "通信できませんでした。" : "Network error." });
    }
  };

  const toggleCommentLike = async (comment: ArticleComment) => {
    if (likeBusyIds.has(comment.id)) return;
    setLikeBusyIds((current) => new Set(current).add(comment.id));
    setListError(null);
    try {
      const response = await fetch(`${base}/comments/${encodeURIComponent(comment.id)}/like`, { method: comment.liked ? "DELETE" : "PUT", headers: { accept: "application/json" } });
      if (!response.ok) { setListError(await readError(response, ja ? "いいねできませんでした。" : "Could not update the like.")); return; }
      const state = await response.json() as { liked: boolean; likeCount: number };
      setComments((current) => mapAll(current, (item) => item.id === comment.id ? { ...item, liked: state.liked, likeCount: state.likeCount } : item));
    } catch {
      setListError(ja ? "通信できませんでした。" : "Network error.");
    } finally {
      setLikeBusyIds((current) => { const next = new Set(current); next.delete(comment.id); return next; });
    }
  };

  const togglePin = async (comment: ArticleComment) => {
    if (pinBusy) return;
    setPinBusy(true);
    setListError(null);
    try {
      const response = await fetch(`${base}/comments/${encodeURIComponent(comment.id)}/pin`, { method: comment.pinned ? "DELETE" : "PUT", headers: { accept: "application/json" } });
      if (!response.ok) { setListError(await readError(response, ja ? "ピン留めできませんでした。" : "Could not update the pin.")); return; }
      setComments((current) => {
        const cleared = current.map((item) => item.pinned ? { ...item, pinned: false } : item);
        if (comment.pinned) return cleared;
        const target = cleared.find((item) => item.id === comment.id);
        return target ? [{ ...target, pinned: true }, ...cleared.filter((item) => item.id !== comment.id)] : cleared;
      });
    } catch {
      setListError(ja ? "通信できませんでした。" : "Network error.");
    } finally {
      setPinBusy(false);
    }
  };

  const renderComment = (comment: ArticleComment, isReply: boolean) => {
    if (comment.removed) {
      return <p className="v2-engagement__removed">{ja ? "削除されたコメント" : "Deleted comment"}</p>;
    }
    const replyOpen = replyTo === comment.id;
    const replyLeft = MAX_LENGTH - Array.from(replyDraft).length;
    return (
      <>
        {comment.pinned ? <p className="v2-engagement__pin-label">{ja ? "ピン留め" : "Pinned"}</p> : null}
        <div className="v2-engagement__head">
          {comment.author.avatarUrl
            // eslint-disable-next-line @next/next/no-img-element -- 利用者の絵は外部URLもあり、最適化の対象にしない。
            ? <img className="v2-engagement__avatar" src={comment.author.avatarUrl} alt="" width={28} height={28} loading="lazy" referrerPolicy="no-referrer" />
            : <span className="v2-engagement__avatar v2-engagement__avatar--placeholder" aria-hidden="true">{Array.from(comment.author.displayName.trim())[0]?.toUpperCase() ?? "?"}</span>}
          <span className="v2-engagement__who">
            {comment.author.handle ? <Link href={`/v2/profile/${comment.author.handle}`}>{comment.author.displayName}</Link> : comment.author.displayName}
          </span>
          <small className="v2-engagement__time"><V2RelativeTime value={comment.createdAt} locale={locale} /></small>
        </div>
        <p className="v2-engagement__body">{comment.body}</p>
        <div className="v2-engagement__actions" role="group" aria-label={ja ? "コメントの操作" : "Comment actions"}>
          {authenticated && !comment.mine ? (
            <button type="button" className="v2-engagement__link v2-engagement__like" aria-pressed={comment.liked} disabled={likeBusyIds.has(comment.id)} onClick={() => void toggleCommentLike(comment)}>
              {ja ? "いいね" : "Like"}{comment.likeCount ? <span className="v2-engagement__like-count"> {comment.likeCount}</span> : null}
            </button>
          ) : comment.likeCount ? (
            <span className="v2-engagement__like-static">{ja ? `いいね ${comment.likeCount}` : `${comment.likeCount} likes`}</span>
          ) : null}
          {authenticated ? (
            <button type="button" className="v2-engagement__link" aria-expanded={replyOpen} aria-controls={`reply-form-${comment.id}`} onClick={() => { setReplyTo(replyOpen ? null : comment.id); setReplyDraft(""); setReplyError(null); }}>{ja ? "返信" : "Reply"}</button>
          ) : null}
          {isAuthor && !isReply ? (
            <button type="button" className="v2-engagement__link" aria-pressed={comment.pinned} disabled={pinBusy} onClick={() => void togglePin(comment)}>{comment.pinned ? (ja ? "ピン留めを外す" : "Unpin") : (ja ? "ピン留め" : "Pin")}</button>
          ) : null}
          {comment.canDelete ? <button type="button" className="v2-engagement__link" onClick={() => void remove(comment)}>{ja ? "削除" : "Delete"}</button> : null}
          {authenticated && !comment.mine
            ? <button type="button" className="v2-engagement__link" aria-expanded={reporting === comment.id} onClick={() => { setReporting(reporting === comment.id ? null : comment.id); setReason(""); setReportNote(null); }}>{ja ? "通報" : "Report"}</button>
            : null}
        </div>
        {replyOpen ? (
          <form className="v2-engagement__form v2-engagement__reply-form" id={`reply-form-${comment.id}`} onSubmit={(event) => { event.preventDefault(); void submitReply(comment); }}>
            <label className="v2-sr" htmlFor={`reply-input-${comment.id}`}>{ja ? `${comment.author.displayName}さんへの返信` : `Reply to ${comment.author.displayName}`}</label>
            <textarea
              id={`reply-input-${comment.id}`}
              className="v2-engagement__input"
              rows={2}
              autoFocus
              value={replyDraft}
              maxLength={MAX_LENGTH * 2}
              placeholder={ja ? "返信を書く" : "Write a reply"}
              onChange={(event) => setReplyDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") { setReplyTo(null); setReplyDraft(""); } }}
            />
            <div className="v2-engagement__form-row">
              <small className={replyLeft < 0 ? "v2-engagement__remaining v2-engagement__remaining--over" : "v2-engagement__remaining"}>{ja ? `あと${replyLeft}字` : `${replyLeft} left`}</small>
              <span className="v2-engagement__form-buttons">
                <V2Button variant="text" label={ja ? "やめる" : "Cancel"} onClick={() => { setReplyTo(null); setReplyDraft(""); }} />
                <V2Button type="submit" variant="primary" label={replyPosting ? (ja ? "送信中…" : "Posting…") : (ja ? "返信する" : "Reply")} disabled={replyPosting || !replyDraft.trim() || replyLeft < 0} />
              </span>
            </div>
            {replyError ? <p role="alert" className="v2-engagement__error">{replyError}</p> : null}
          </form>
        ) : null}
        {reporting === comment.id ? (
          <form className="v2-engagement__report" onSubmit={(event) => { event.preventDefault(); void report(comment); }}>
            <label className="v2-sr" htmlFor={`report-${comment.id}`}>{ja ? "通報の理由" : "Reason"}</label>
            <input id={`report-${comment.id}`} type="text" value={reason} maxLength={300} placeholder={ja ? "理由（例：中傷、迷惑、無関係な宣伝）" : "Reason"} onChange={(event) => setReason(event.target.value)} />
            <V2Button type="submit" variant="text" label={ja ? "通報する" : "Report"} disabled={!reason.trim()} />
          </form>
        ) : null}
        {reportNote?.id === comment.id ? <p role="status" className={reportNote.ok ? "v2-engagement__note" : "v2-engagement__error"}>{reportNote.message}</p> : null}
      </>
    );
  };

  const remaining = MAX_LENGTH - Array.from(draft).length;

  return (
    <section className="v2-engagement" aria-label={ja ? "反応とコメント" : "Reactions and comments"}>
      <div className="v2-engagement__bar">
        {authenticated
          ? <V2Button icon="heart" variant="text" label={ja ? "いいね" : "Like"} count={likeCount || undefined} pressed={liked} disabled={likeBusy} onClick={() => void toggleLike()} />
          : <Link className="v2-button v2-button--text" href={signIn}><span className="v2-button__label">{ja ? `ログインしていいね${likeCount ? `（${likeCount}）` : ""}` : `Sign in to like${likeCount ? ` (${likeCount})` : ""}`}</span></Link>}
        {initial.commentsEnabled ? <span className="v2-engagement__count">{ja ? `コメント ${total}件` : `${total} comments`}</span> : null}
        {likeError ? <span role="status" className="v2-engagement__error">{likeError}</span> : null}
      </div>

      {!initial.commentsEnabled ? (
        <p className="v2-engagement__off">{ja ? "この記事は、書き手がコメントを受け付けない設定にしています。" : "The author has turned comments off for this article."}</p>
      ) : (
        <div className="v2-engagement__comments" id="comments">
          <h2 className="v2-engagement__title">{ja ? "コメント" : "Comments"}</h2>

          {authenticated ? (
            <form className="v2-engagement__form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <label className="v2-sr" htmlFor="article-comment-input">{ja ? "コメントを書く" : "Write a comment"}</label>
              <textarea
                id="article-comment-input"
                className="v2-engagement__input"
                rows={3}
                value={draft}
                maxLength={MAX_LENGTH * 2}
                placeholder={ja ? "この記事へのコメントを書く" : "Write a comment on this article"}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="v2-engagement__form-row">
                <small className={remaining < 0 ? "v2-engagement__remaining v2-engagement__remaining--over" : "v2-engagement__remaining"}>{ja ? `あと${remaining}字` : `${remaining} left`}</small>
                <V2Button type="submit" variant="primary" label={posting ? (ja ? "送信中…" : "Posting…") : (ja ? "コメントする" : "Comment")} disabled={posting || !draft.trim() || remaining < 0} />
              </div>
              {postError ? <p role="alert" className="v2-engagement__error">{postError}</p> : null}
            </form>
          ) : (
            <p className="v2-engagement__signin"><Link href={signIn}>{ja ? "ログインしてコメントする" : "Sign in to comment"}</Link></p>
          )}

          {comments.length ? (
            <ul className="v2-engagement__list">
              {comments.map((comment) => {
                const open = expanded.has(comment.id);
                const hiddenCount = open ? 0 : Math.max(0, comment.replies.length - REPLIES_SHOWN);
                const shown = hiddenCount ? comment.replies.slice(0, REPLIES_SHOWN) : comment.replies;
                return (
                  <li key={comment.id} className={comment.pinned ? "v2-engagement__item v2-engagement__item--pinned" : "v2-engagement__item"} id={`comment-${comment.id}`}>
                    {renderComment(comment, false)}
                    {comment.replies.length ? (
                      <ul className="v2-engagement__replies" aria-label={ja ? "返信" : "Replies"}>
                        {shown.map((reply) => (
                          <li key={reply.id} className="v2-engagement__reply" id={`comment-${reply.id}`}>{renderComment(reply, true)}</li>
                        ))}
                      </ul>
                    ) : null}
                    {hiddenCount ? (
                      <button type="button" className="v2-engagement__link v2-engagement__expand" aria-expanded={false} onClick={() => setExpanded((current) => new Set(current).add(comment.id))}>
                        {ja ? `返信をすべて表示（${comment.replies.length}件）` : `Show all ${comment.replies.length} replies`}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="v2-engagement__empty">{ja ? "まだコメントはありません。" : "No comments yet."}</p>
          )}

          {listError ? <p role="alert" className="v2-engagement__error">{listError}</p> : null}
          {cursor ? (
            <p className="v2-engagement__more">
              <V2Button variant="text" label={loadingMore ? (ja ? "読み込み中…" : "Loading…") : (ja ? "さらに読む" : "Load more")} disabled={loadingMore} onClick={() => void loadMore()} />
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
