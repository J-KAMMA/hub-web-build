"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2GatedRefreshCard } from "@/components/v2/v2-gated-refresh-card";
import type { ThreadPageData } from "@/lib/server/thread-page-data";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";
import { ROLE_LABELS } from "@/lib/thread-knowledge";
import { threadPostDisplayBody } from "@/lib/thread-replies";
import { researchDiscussionReference, researchGitDiscussionReference } from "@/lib/research-discussion-reference";
import { ThreadAuthorControl } from "@/components/thread-author-control";

/*
 * スレッドの投稿1件。既存の .bbs-post とは別物で、既存には触れない。
 *
 * 落とさなかったもの: レス番号（#post-{no} のアンカー）、匿名／アカウント、
 * 作成者・選ばれた回答・役割・鮮度の札、編集済み／削除済み／運営非表示、
 * 返信先、ブロック／ミュートの伏せ、画像、いいね・保存、品質の投票3種
 * （参考になる／一次情報／古い情報）、引用して返信、ベストアンサーの採用。
 *
 * まだ無いもの: 番号メニュー（リンクのコピー・通報・ミュート）、編集・削除・
 * 履歴、翻訳、外部リンクカード、出典の表示、直下の返信の束、AI/Hubpediaへ渡す。
 */

export type V2ThreadPostData = ThreadPageData["posts"][number];

type Engagement = {
  likeCount: number;
  liked: boolean;
  bookmarked: boolean;
  pending: boolean;
};

const QUALITY: { dimension: string; ja: string; en: string; value: 1 | -1 }[] = [
  { dimension: "helpful", ja: "参考になる", en: "Helpful", value: 1 },
  { dimension: "primary_source", ja: "一次情報", en: "Primary source", value: 1 },
  { dimension: "outdated", ja: "古い情報", en: "Outdated", value: -1 },
];

export function V2ThreadPost({
  threadId,
  post,
  isThreadAuthor,
  isBestAnswer,
  canPickBestAnswer,
  authenticated,
  locale,
  onError,
}: {
  threadId: string;
  post: V2ThreadPostData;
  isThreadAuthor: boolean;
  isBestAnswer: boolean;
  canPickBestAnswer: boolean;
  authenticated: boolean;
  locale: string;
  onError?: (message: string | null) => void;
}) {
  const ja = locale === "ja";
  const [engagement, setEngagement] = useState<Engagement>({
    likeCount: post.engagement.likeCount,
    liked: post.engagement.viewerReaction === "like",
    bookmarked: post.engagement.bookmarked,
    pending: false,
  });
  const [scores, setScores] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [bestAnswer, setBestAnswer] = useState(isBestAnswer);
  /* 番号メニュー（••• ）。リンクの複製・編集・削除・ミュート・ブロック・通報。 */
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<"none" | "edit" | "report">("none");
  const [body, setBody] = useState(post.body);
  const researchReference = researchDiscussionReference(body);
  const gitReference = researchGitDiscussionReference(body);
  useEffect(() => { setBody(post.body); }, [post.id, post.body]);
  const [draft, setDraft] = useState("");
  const [editReason, setEditReason] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const hidden = post.moderatedAt
    ? "moderated"
    : post.deletedAt || deleted
      ? "deleted"
      : post.viewerBlocked
        ? "blocked"
        : post.viewerMuted
          ? "muted"
          : null;

  const toggle = useCallback(async (kind: "reaction" | "bookmark") => {
    if (engagement.pending) return;
    const before = engagement;
    const wasOn = kind === "reaction" ? engagement.liked : engagement.bookmarked;
    setEngagement((previous) => ({
      ...previous,
      pending: true,
      liked: kind === "reaction" ? !wasOn : previous.liked,
      likeCount: kind === "reaction" ? previous.likeCount + (wasOn ? -1 : 1) : previous.likeCount,
      bookmarked: kind === "bookmark" ? !wasOn : previous.bookmarked,
    }));
    try {
      const response = await fetch(`/api/engagements/${kind}`, {
        method: wasOn ? "DELETE" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_type: "thread_post",
          target_id: post.id,
          active: !wasOn,
          ...(kind === "reaction" ? { kind: "like" } : {}),
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as {
        summary?: { likeCount: number; bookmarked: boolean; viewerReaction: string | null };
      };
      setEngagement((previous) => ({
        likeCount: payload.summary?.likeCount ?? previous.likeCount,
        liked: payload.summary ? payload.summary.viewerReaction === "like" : previous.liked,
        bookmarked: payload.summary?.bookmarked ?? previous.bookmarked,
        pending: false,
      }));
      onError?.(null);
    } catch {
      setEngagement({ ...before, pending: false });
      onError?.(ja ? "反映できませんでした。通信を確かめてもう一度お試しください。" : "That did not go through.");
    }
  }, [engagement, post.id, ja, onError]);

  const vote = async (dimension: string, value: number) => {
    if (!authenticated || busy) return;
    setBusy(dimension);
    try {
      const response = await fetch(`/api/bbs/threads/${threadId}/knowledge-platform`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "quality_vote", postId: post.id, dimension, value }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { scores: { dimension: string; score: number }[] };
      setScores(Object.fromEntries(payload.scores.map((item) => [item.dimension, Number(item.score)])));
      onError?.(null);
    } catch {
      onError?.(ja ? "評価を送れませんでした。" : "Could not send the vote.");
    } finally {
      setBusy("");
    }
  };

  const pickBestAnswer = async () => {
    try {
      const response = await fetch(`/api/bbs/threads/${threadId}/best-answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ post_id: bestAnswer ? null : post.id }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setBestAnswer((previous) => !previous);
      onError?.(null);
    } catch {
      onError?.(ja ? "採用する回答を更新できませんでした。" : "Could not update the accepted answer.");
    }
  };

  const quote = () => {
    const selection = window.getSelection()?.toString().trim();
    window.dispatchEvent(new CustomEvent("hub:thread-quote", { detail: { threadId, postId: post.id, no: post.no, text: (selection || post.body).slice(0, 500) } }));
    document.getElementById("v2-thread-reply")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const request = async (url: string, method: string, payload?: unknown) => {
    const response = await fetch(url, {
      method,
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error || String(response.status));
    return data;
  };

  const fail = (caught: unknown, fallback: string) => {
    onError?.(caught instanceof Error && caught.message ? caught.message : fallback);
  };

  const openPanel = (next: "edit" | "report") => {
    setMenuOpen(false);
    setNotice(null);
    if (next === "edit") { setDraft(body); setEditReason(""); }
    setPanel((current) => (current === next ? "none" : next));
  };

  const copyLink = async () => {
    setMenuOpen(false);
    const url = `${window.location.origin}/v2/threads/${threadId}#post-${post.no}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(ja ? `#${post.no} のリンクを複製しました。` : `Copied the link to #${post.no}.`);
    } catch {
      onError?.(ja ? "リンクを複製できませんでした。" : "Could not copy the link.");
    }
  };

  const submitEdit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy("edit");
    try {
      const data = await request(`/api/bbs/thread-posts/${encodeURIComponent(post.id)}`, "PATCH", { body: text, edit_reason: editReason.trim() }) as { post?: { body?: string } };
      setBody(data.post?.body ?? text);
      setPanel("none");
      setNotice(ja ? "編集しました。" : "Edited.");
      onError?.(null);
    } catch (caught) {
      fail(caught, ja ? "投稿を編集できませんでした。" : "Could not edit the post.");
    } finally {
      setBusy("");
    }
  };

  const deletePost = async () => {
    setMenuOpen(false);
    if (busy) return;
    if (!window.confirm(ja ? `#${post.no} を削除しますか。番号と返信関係は残ります。` : `Delete #${post.no}? The number and reply links stay.`)) return;
    setBusy("delete");
    try {
      await request(`/api/bbs/thread-posts/${encodeURIComponent(post.id)}`, "DELETE");
      setDeleted(true);
      onError?.(null);
    } catch (caught) {
      fail(caught, ja ? "投稿を削除できませんでした。" : "Could not delete the post.");
    } finally {
      setBusy("");
    }
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("report");
    try {
      await request(`/api/bbs/thread-posts/${encodeURIComponent(post.id)}/report`, "POST", { reason: form.get("reason"), details: String(form.get("details") ?? "").trim() });
      setPanel("none");
      setNotice(ja ? "通報を受け付けました。" : "Report received.");
      onError?.(null);
    } catch (caught) {
      fail(caught, ja ? "通報を送信できませんでした。" : "Could not send the report.");
    } finally {
      setBusy("");
    }
  };

  const freshness = post.knowledge?.freshness;
  const sources = Array.isArray(post.knowledge?.sources) ? post.knowledge.sources.slice(0, 5).flatMap((source) => {
    try {
      if (!source || typeof source.url !== "string" || source.url.length > 2048 || /[\p{Cc}\p{Surrogate}]/u.test(source.url)) return [];
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2048) return [];
      return [{ href: url.href, label: typeof source.label === "string" && source.label.trim() ? source.label.slice(0, 100) : url.hostname.slice(0, 100) }];
    } catch { return []; }
  }) : [];
  const postLink = (no: number) => Math.floor((post.no - 1) / 50) === Math.floor((no - 1) / 50)
    ? `#post-${no}` : `/v2/threads/${encodeURIComponent(threadId)}?page=${Math.floor((no - 1) / 50) + 1}#post-${no}`;

  if (post.accessGate) {
    return (
      <article id={`post-${post.no}`} className="v2-tpost">
        <V2GatedRefreshCard
          gate={post.accessGate.gate}
          status={post.accessGate.status}
          title={`#${post.no}`}
          targetType="thread"
          targetId={threadId}
        />
      </article>
    );
  }

  return (
    <article
      id={`post-${post.no}`}
      className={[
        "v2-tpost",
        bestAnswer ? "v2-tpost--best" : "",
        hidden ? "v2-tpost--hidden" : "",
      ].filter(Boolean).join(" ")}
    >
      <a className="v2-tpost__no" href={`#post-${post.no}`}>#{post.no}</a>

      <div className="v2-tpost__body">
        <header className="v2-post__header">
          {post.authorHandle
            ? <Link className="v2-post__name" href={`/v2/profile/${post.authorHandle}`}>{post.displayName}</Link>
            : <span className="v2-post__name">{post.displayName}</span>}
          {post.authorHandle ? <span className="v2-post__handle">@{post.authorHandle}</span> : null}
          {isThreadAuthor ? <span className="v2-badge">{ja ? "作成者" : "Author"}</span> : null}
          {bestAnswer ? <span className="v2-badge v2-badge--best">{ja ? "✓ 選ばれた回答" : "✓ Accepted"}</span> : null}
          {post.knowledge?.role && post.knowledge.role !== "unspecified"
            ? <span className="v2-badge">{ROLE_LABELS[post.knowledge.role]}</span>
            : null}
          {freshness && freshness !== "current"
            ? <span className="v2-badge v2-badge--warn">{freshness === "outdated" ? (ja ? "情報が古い" : "Outdated") : (ja ? "要確認" : "Needs check")}</span>
            : null}
          <span className="v2-post__time"><V2RelativeTime value={post.createdAt} locale={locale} /></span>
          {post.editedAt && !post.deletedAt ? <span className="v2-post__time">{ja ? "編集済み" : "edited"}</span> : null}
        </header>

        {post.replyToPostId && Number.isSafeInteger(post.replyTargetNo) && post.replyTargetNo! > 0 ? (
          <a className="v2-tpost__reply-to" href={postLink(post.replyTargetNo!)}>
            {ja ? "返信先" : "In reply to"} #{post.replyTargetNo} {post.replyTargetDisplayName ?? ""}
          </a>
        ) : null}

        {hidden === "moderated" ? (
          <p className="v2-tpost__hidden">
            <strong>{ja ? "運営により非表示になりました。" : "Hidden by moderators."}</strong>{" "}
            {post.moderationReason || (ja ? "コミュニティガイドラインをご確認ください。" : "See the community guidelines.")}
          </p>
        ) : hidden === "deleted" ? (
          <p className="v2-tpost__hidden">{ja ? "投稿者により削除されました。" : "Deleted by the author."}</p>
        ) : hidden ? (
          <p className="v2-tpost__hidden">
            {hidden === "blocked"
              ? (ja ? "安全設定により表示されない投稿です。" : "Safety settings hide this post.")
              : (ja ? "ミュートした投稿者の投稿です。" : "From someone you muted.")}
          </p>
        ) : panel === "edit" ? (
          <div className="v2-post__panel">
            <textarea
              className="v2-reply__input"
              value={draft}
              maxLength={4000}
              disabled={busy === "edit"}
              aria-label={ja ? "編集する本文" : "Edited body"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submitEdit(); }}
            />
            <input
              className="v2-tnew__title"
              type="text"
              value={editReason}
              maxLength={300}
              placeholder={ja ? "編集の理由（任意、300字まで）" : "Reason for the edit (optional)"}
              aria-label={ja ? "編集の理由" : "Edit reason"}
              onChange={(event) => setEditReason(event.target.value)}
            />
            <div className="v2-reply__footer">
              <V2Button variant="text" label={ja ? "やめる" : "Cancel"} onClick={() => setPanel("none")} />
              <V2Button variant="primary" label={busy === "edit" ? (ja ? "保存しています…" : "Saving…") : (ja ? "保存する" : "Save")} disabled={!draft.trim() || busy === "edit"} onClick={() => void submitEdit()} />
            </div>
          </div>
        ) : (
          <><p className="v2-post__text">{threadPostDisplayBody(body, Boolean(post.replyToPostId))}</p>
          {researchReference ? <Link prefetch={false} href={researchReference.href}>{ja ? `参照した文書の版（v${researchReference.version}）` : `Referenced document (v${researchReference.version})`}</Link> : null}
          {gitReference ? <Link prefetch={false} href={gitReference.href}>{ja ? `参照したコードの変更（${gitReference.oid.slice(0,12)}）` : `Referenced commit (${gitReference.oid.slice(0,12)})`}</Link> : null}</>
        )}

        {!hidden && sources.length ? <ul className="v2-tpost__sources" aria-label={ja ? "出典" : "Sources"}>
          {sources.map((source, index) => <li key={`${source.href}:${index}`}><a href={source.href} target="_blank" rel="noopener noreferrer">{source.label}</a></li>)}
        </ul> : null}
        {!hidden && Number.isSafeInteger(post.knowledge?.correctedByPostNo) && post.knowledge!.correctedByPostNo! > 0 ?
          <a className="v2-tpost__reply-to" href={postLink(post.knowledge!.correctedByPostNo!)}>{ja ? "訂正・更新" : "Correction or update"} #{post.knowledge!.correctedByPostNo}</a> : null}

        {(hidden === "blocked" || hidden === "muted") && authenticated && post.canControlAuthor ? (
          <ThreadAuthorControl postId={post.id} locale={locale} className="v2-menu__item" confirmEnable disabled={Boolean(busy)} />
        ) : null}
        {!hidden && post.images?.length ? (
          <div className="v2-post__images">
            {post.images.map((image) => (
              <a key={image.id} href={image.url}>
                <img src={image.url} width={image.width} height={image.height} alt={image.altText} loading="lazy" />
              </a>
            ))}
          </div>
        ) : null}

        {!hidden ? (
          <div className="v2-post__actions">
            <V2Button icon="heart" label={ja ? "いいね" : "Like"} count={engagement.likeCount || undefined} pressed={engagement.liked} disabled={!authenticated} onClick={() => void toggle("reaction")} />
            <V2Button icon="bookmark" label={engagement.bookmarked ? (ja ? "保存済み" : "Saved") : (ja ? "保存" : "Save")} pressed={engagement.bookmarked} disabled={!authenticated} onClick={() => void toggle("bookmark")} />
            {authenticated ? <V2Button icon="quote" label={ja ? "引用して返信" : "Quote"} onClick={quote} /> : null}
            {/* 評価と採用は ••• の中。行に文字のボタンが4つ並ぶと読む邪魔だった（2026-09-03）。 */}
            <div className="v2-post__more" ref={menuRef}>
              <V2Button icon="more" label={ja ? `#${post.no} の操作` : `Actions for #${post.no}`} expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)} />
              {menuOpen ? (
                <div className="v2-menu" role="menu">
                  {post.no > 1 ? QUALITY.map((item) => (
                    <button
                      key={item.dimension}
                      type="button"
                      role="menuitemcheckbox"
                      className="v2-menu__item"
                      aria-checked={Boolean(scores[item.dimension])}
                      disabled={!authenticated || Boolean(busy)}
                      onClick={() => { setMenuOpen(false); void vote(item.dimension, item.value); }}
                    >
                      {scores[item.dimension] ? "✓ " : ""}{ja ? item.ja : item.en}
                    </button>
                  )) : null}
                  {canPickBestAnswer && post.no > 1 ? (
                    <button type="button" role="menuitem" className="v2-menu__item" onClick={() => { setMenuOpen(false); void pickBestAnswer(); }}>
                      {bestAnswer ? (ja ? "採用を解除" : "Unaccept") : (ja ? "この回答を採用" : "Accept answer")}
                    </button>
                  ) : null}
                  <button type="button" role="menuitem" className="v2-menu__item" onClick={() => void copyLink()}>{ja ? "リンクを複製" : "Copy link"}</button>
                  {post.viewerIsAuthor ? (
                    <>
                      <button type="button" role="menuitem" className="v2-menu__item" onClick={() => openPanel("edit")}>{ja ? "編集" : "Edit"}</button>
                      <button type="button" role="menuitem" className="v2-menu__item v2-menu__item--danger" onClick={() => void deletePost()}>{ja ? "削除" : "Delete"}</button>
                    </>
                  ) : null}
                  {authenticated && post.canControlAuthor ? (
                    <ThreadAuthorControl postId={post.id} locale={locale} className="v2-menu__item" confirmEnable disabled={Boolean(busy)} />
                  ) : null}
                  {authenticated && !post.viewerIsAuthor ? (
                    <button type="button" role="menuitem" className="v2-menu__item v2-menu__item--danger" onClick={() => openPanel("report")}>{ja ? "通報" : "Report"}</button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {notice ? <p className="v2-note v2-post__notice" role="status">{notice}</p> : null}

        {panel === "report" ? (
          <form className="v2-post__panel" onSubmit={submitReport}>
            <label className="v2-filter__row">
              <span>{ja ? "理由" : "Reason"}</span>
              <select name="reason" defaultValue="spam">
                <option value="spam">{ja ? "スパム" : "Spam"}</option>
                <option value="harassment">{ja ? "嫌がらせ" : "Harassment"}</option>
                <option value="privacy">{ja ? "個人情報" : "Privacy"}</option>
                <option value="misinformation">{ja ? "誤情報" : "Misinformation"}</option>
                <option value="other">{ja ? "その他" : "Other"}</option>
              </select>
            </label>
            <textarea className="v2-reply__input" name="details" rows={3} maxLength={500} placeholder={ja ? "詳しく（任意、500字まで）" : "Details (optional)"} />
            <div className="v2-reply__footer">
              <V2Button variant="text" label={ja ? "やめる" : "Cancel"} onClick={() => setPanel("none")} />
              <V2Button variant="primary" type="submit" label={ja ? "通報する" : "Report"} disabled={busy === "report"} />
            </div>
          </form>
        ) : null}
      </div>
    </article>
  );
}
