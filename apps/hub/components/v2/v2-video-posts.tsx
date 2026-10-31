"use client";

import Link from "next/link";
import { useState } from "react";

import { V2Post, type V2PostData } from "@/components/v2/v2-post";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";

/*
 * 動画・音楽作品のポスト。動画ページで書いたポストと、動画のリンクを含むポストをここに並べる。
 * 書く・リポストする・続きを読む、はどれも /api/videos/{id}/posts を通る。
 * 一覧の各行は他の画面と同じ V2Post なので、いいね・返信・通報もそのまま使える。
 */
export function V2VideoPosts({
  videoId,
  kind = "video",
  initialPosts,
  initialCursor,
  viewerId,
  locale,
}: {
  /** 対象のID（kind が music なら作品ID）。 */
  videoId: string;
  kind?: "video" | "music";
  initialPosts: V2PostData[];
  initialCursor: string | null;
  viewerId: string;
  locale: string;
}) {
  const ja = locale === "ja";
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const music = kind === "music";
  const base = music ? `/api/music/works/${encodeURIComponent(videoId)}/posts` : `/api/videos/${encodeURIComponent(videoId)}/posts`;
  const failed = ja ? "ポストできませんでした。時間をおいてもう一度お試しください。" : "Could not post. Try again later.";

  const create = async (body: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
      const payload = await response.json().catch(() => ({})) as { post?: V2PostData };
      if (!response.ok || !payload.post) throw new Error("failed");
      setPosts((current) => [payload.post as V2PostData, ...current]);
      if (body) setDraft("");
      setError(null);
    } catch {
      setError(failed);
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

  return (
    <section className="v2-vthread" aria-label={ja ? "ポスト" : "Posts"}>
      {error ? <p className="v2-error" role="status">{error}</p> : null}
      {viewerId ? (
        <form className="v2-reply v2-reply--plain" onSubmit={(event) => { event.preventDefault(); const body = draft.trim(); if (body) void create(body); }}>
          <textarea className="v2-reply__input" value={draft} maxLength={HUB_SOCIAL_POST_MAX_CHARACTERS} rows={3}
            placeholder={music ? (ja ? "この作品についてポストする" : "Post about this work") : (ja ? "この動画についてポストする" : "Post about this video")} aria-label={ja ? "ポストの本文" : "Post text"}
            onChange={(event) => setDraft(event.target.value)} />
          <div className="v2-reply__footer">
            <span className="v2-reply__remaining" aria-live="polite">{HUB_SOCIAL_POST_MAX_CHARACTERS - draft.length}</span>
            <button type="button" className="v2-reply__submit" disabled={busy} onClick={() => void create("")}>{ja ? "リポスト" : "Repost"}</button>
            <button type="submit" className="v2-reply__submit" disabled={busy || !draft.trim()}>{ja ? "ポスト" : "Post"}</button>
          </div>
        </form>
      ) : (
        <p className="v2-note v2-reply-auth"><Link href="/v2/auth">{ja ? "ログイン" : "Sign in"}</Link>{ja ? "するとポストできます。" : " to post."}</p>
      )}
      {posts.length ? (
        <div className="v2-feed">
          {posts.map((post) => (
            <div key={post.id}>
              <V2Post post={post} viewerId={viewerId} locale={locale} onError={setError}
                onCreated={(created) => setPosts((current) => [created, ...current])}
                onRemoved={(postId) => setPosts((current) => current.filter((item) => item.id !== postId))} />
            </div>
          ))}
        </div>
      ) : <p className="v2-note">{music ? (ja ? "この作品のポストはまだありません。" : "No posts about this work yet.") : (ja ? "この動画のポストはまだありません。" : "No posts about this video yet.")}</p>}
      {cursor ? <button type="button" className="v2-reply__submit" disabled={busy} onClick={() => void more()}>{ja ? "もっと見る" : "Load more"}</button> : null}
    </section>
  );
}
