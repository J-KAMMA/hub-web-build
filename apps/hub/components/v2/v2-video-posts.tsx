"use client";

import Link from "next/link";
import { useState } from "react";

import { V2Post, type V2PostData } from "@/components/v2/v2-post";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";

export type VideoCommentPolicyValue = "everyone" | "followers" | "nobody";

const POLICY_LABELS: Record<VideoCommentPolicyValue, { ja: string; en: string }> = {
  everyone: { ja: "だれでもコメントできる", en: "Anyone can comment" },
  followers: { ja: "フォロワーだけ", en: "Followers only" },
  nobody: { ja: "コメントを受け付けない", en: "Comments closed" },
};

/*
 * 動画のコメント（動画に返信するポスト）。書く・続きを読む・（持ち主は）非表示にする、はどれも
 * /api/videos/{id}/posts と /api/posts/{id}/hide-on-video を通る。コメントは「フィードにも出す」に
 * チェックを入れたときだけフォロワーのフィードに載る（既定は載せない）。
 * 各行は他の画面と同じ V2Post なので、いいね・返信・引用・ブックマーク・通報はそのまま使える。
 * 音楽作品のポストも同じ部品を使う（kind="music"。こちらは従来どおりリポストあり）。
 */
export function V2VideoPosts({
  videoId,
  kind = "video",
  initialPosts,
  initialCursor,
  viewerId,
  locale,
  canModerate = false,
  initialPolicy = "everyone",
}: {
  /** 対象のID（kind が music なら作品ID）。 */
  videoId: string;
  kind?: "video" | "music";
  initialPosts: V2PostData[];
  initialCursor: string | null;
  viewerId: string;
  locale: string;
  /** Hub の動画の持ち主だけ true。非表示とコメント設定を出す。外部動画の持ち主はいない。 */
  canModerate?: boolean;
  initialPolicy?: VideoCommentPolicyValue;
}) {
  const ja = locale === "ja";
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [draft, setDraft] = useState("");
  const [inFeed, setInFeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<VideoCommentPolicyValue>(initialPolicy);
  const [hidden, setHidden] = useState<{ posts: V2PostData[]; cursor: string | null } | null>(null);
  const music = kind === "music";
  const base = music ? `/api/music/works/${encodeURIComponent(videoId)}/posts` : `/api/videos/${encodeURIComponent(videoId)}/posts`;
  const failed = ja ? "コメントできませんでした。時間をおいてもう一度お試しください。" : "Could not post. Try again later.";
  const refusals: Record<string, string> = {
    comments_closed: ja ? "この動画はコメントを受け付けていません。" : "Comments are closed on this video.",
    comments_followers_only: ja ? "この動画は持ち主のフォロワーだけがコメントできます。" : "Only the owner's followers can comment.",
    video_locked: ja ? "この動画の閲覧条件を満たすとコメントできます。" : "Meet the viewing condition to comment.",
  };

  // On the video's own page the 「動画への返信」 line only repeats the page it is on.
  const withoutOwnVideoLine = (post: V2PostData): V2PostData =>
    post.replyToVideo?.id === videoId ? { ...post, replyToVideo: undefined } : post;

  const create = async (body: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(music ? { body } : { body, inFeed }),
      });
      const payload = await response.json().catch(() => ({})) as { post?: V2PostData; error?: string };
      if (!response.ok || !payload.post) throw new Error(payload.error && refusals[payload.error] ? payload.error : "failed");
      setPosts((current) => [payload.post as V2PostData, ...current]);
      if (body) setDraft("");
      setInFeed(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error && refusals[caught.message] ? refusals[caught.message] : failed);
    } finally {
      setBusy(false);
    }
  };

  const more = async () => {
    if (busy || !cursor) return;
    setBusy(true);
    try {
      const response = await fetch(`${base}?cursor=${encodeURIComponent(cursor)}`);
      const payload = await response.json().catch(() => ({})) as { posts?: V2PostData[]; nextCursor?: string | null };
      if (!response.ok || !payload.posts) throw new Error("failed");
      const next = payload.posts;
      setPosts((current) => [...current, ...next.filter((post) => !current.some((item) => item.id === post.id))]);
      setCursor(payload.nextCursor ?? null);
      setError(null);
    } catch {
      setError(ja ? "続きを読み込めませんでした。" : "Could not load more.");
    } finally {
      setBusy(false);
    }
  };

  const changePolicy = async (next: VideoCommentPolicyValue) => {
    const previous = policy;
    setPolicy(next);
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/comment-policy`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ policy: next }),
      });
      if (!response.ok) throw new Error("failed");
      setError(null);
    } catch {
      setPolicy(previous);
      setError(ja ? "コメントの設定を変えられませんでした。" : "Could not change the comment setting.");
    }
  };

  const loadHidden = async (after?: string | null) => {
    if (busy) return;
    setBusy(true);
    try {
      const query = after ? `&cursor=${encodeURIComponent(after)}` : "";
      const response = await fetch(`${base}?hidden=1${query}`);
      const payload = await response.json().catch(() => ({})) as { posts?: V2PostData[]; nextCursor?: string | null };
      if (!response.ok || !payload.posts) throw new Error("failed");
      const next = payload.posts;
      setHidden((current) => ({
        posts: [...(after && current ? current.posts : []), ...next.filter((post) => !(after && current?.posts.some((item) => item.id === post.id)))],
        cursor: payload.nextCursor ?? null,
      }));
      setError(null);
    } catch {
      setError(ja ? "非表示のコメントを読み込めませんでした。" : "Could not load hidden comments.");
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = async (postId: string, hide: boolean) => {
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/hide-on-video`, { method: hide ? "POST" : "DELETE" });
      if (!response.ok) throw new Error("failed");
      if (hide) {
        const target = posts.find((item) => item.id === postId);
        setPosts((current) => current.filter((item) => item.id !== postId));
        if (target) setHidden((current) => (current ? { ...current, posts: [{ ...target, hiddenByVideoOwner: true }, ...current.posts] } : current));
      } else {
        const target = hidden?.posts.find((item) => item.id === postId);
        setHidden((current) => (current ? { ...current, posts: current.posts.filter((item) => item.id !== postId) } : current));
        if (target) setPosts((current) => [{ ...target, hiddenByVideoOwner: false }, ...current]);
      }
      setError(null);
    } catch {
      setError(ja ? "コメントの表示を変えられませんでした。" : "Could not change the comment's visibility.");
    }
  };

  const sectionLabel = music ? (ja ? "ポスト" : "Posts") : (ja ? "コメント" : "Comments");
  return (
    <section className="v2-vthread" aria-label={sectionLabel}>
      {error ? <p className="v2-error" role="status">{error}</p> : null}
      {canModerate && !music ? (
        <label className="v2-note">
          {ja ? "コメントの受け付け " : "Who can comment "}
          <select value={policy} onChange={(event) => void changePolicy(event.target.value as VideoCommentPolicyValue)}>
            {(Object.keys(POLICY_LABELS) as VideoCommentPolicyValue[]).map((value) => (
              <option key={value} value={value}>{ja ? POLICY_LABELS[value].ja : POLICY_LABELS[value].en}</option>
            ))}
          </select>
        </label>
      ) : null}
      {viewerId ? (
        <form className="v2-reply v2-reply--plain" onSubmit={(event) => { event.preventDefault(); const body = draft.trim(); if (body) void create(body); }}>
          <textarea className="v2-reply__input" value={draft} maxLength={HUB_SOCIAL_POST_MAX_CHARACTERS} rows={3}
            placeholder={music ? (ja ? "この作品についてポストする" : "Post about this work") : (ja ? "コメントを書く" : "Write a comment")} aria-label={music ? (ja ? "作品についてのポスト" : "Post about this work") : (ja ? "動画へのコメント" : "Comment on this video")}
            onChange={(event) => setDraft(event.target.value)} />
          {music ? null : (
            <label className="v2-note">
              <input type="checkbox" checked={inFeed} onChange={(event) => setInFeed(event.target.checked)} />
              {" "}{ja ? "フィードにも出す" : "Also show in the feed"}
            </label>
          )}
          <div className="v2-reply__footer">
            <span className="v2-reply__remaining" aria-live="polite">{HUB_SOCIAL_POST_MAX_CHARACTERS - draft.length}</span>
            {music ? <button type="button" className="v2-reply__submit" disabled={busy} onClick={() => void create("")}>{ja ? "リポスト" : "Repost"}</button> : null}
            <button type="submit" className="v2-reply__submit" disabled={busy || !draft.trim()}>{music ? (ja ? "ポスト" : "Post") : (ja ? "コメントする" : "Comment")}</button>
          </div>
        </form>
      ) : (
        <p className="v2-note v2-reply-auth"><Link href="/v2/auth">{ja ? "ログイン" : "Sign in"}</Link>{ja ? "するとコメントできます。" : " to comment."}</p>
      )}
      {posts.length ? (
        <div className="v2-feed">
          {posts.map((post) => (
            <div key={post.id}>
              <V2Post post={withoutOwnVideoLine(post)} viewerId={viewerId} locale={locale} onError={setError}
                videoOwnerHide={canModerate && !music ? { hidden: false, onToggle: toggleHidden } : undefined}
                onCreated={(created) => setPosts((current) => [created, ...current])}
                onRemoved={(postId) => setPosts((current) => current.filter((item) => item.id !== postId))} />
            </div>
          ))}
        </div>
      ) : <p className="v2-note">{music ? (ja ? "この作品のポストはまだありません。" : "No posts about this work yet.") : (ja ? "この動画へのコメントはまだありません。" : "No comments on this video yet.")}</p>}
      {cursor ? <button type="button" className="v2-reply__submit" disabled={busy} onClick={() => void more()}>{ja ? "もっと見る" : "Load more"}</button> : null}
      {canModerate && !music ? (
        <div>
          <h3 className="v2-note">{ja ? "非表示のコメント" : "Hidden comments"}</h3>
          {hidden === null ? (
            <button type="button" className="v2-reply__submit" disabled={busy} onClick={() => void loadHidden()}>{ja ? "非表示のコメントを見る" : "Show hidden comments"}</button>
          ) : hidden.posts.length ? (
            <div className="v2-feed">
              {hidden.posts.map((post) => (
                <div key={post.id}>
                  <V2Post post={withoutOwnVideoLine(post)} viewerId={viewerId} locale={locale} onError={setError}
                    videoOwnerHide={{ hidden: true, onToggle: toggleHidden }} />
                </div>
              ))}
            </div>
          ) : <p className="v2-note">{ja ? "非表示のコメントはありません。" : "No hidden comments."}</p>}
          {hidden?.cursor ? <button type="button" className="v2-reply__submit" disabled={busy} onClick={() => void loadHidden(hidden.cursor)}>{ja ? "もっと見る" : "Load more"}</button> : null}
        </div>
      ) : null}
    </section>
  );
}
