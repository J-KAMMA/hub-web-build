"use client";

import Link from "next/link";
import { useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2Post, type V2PostData } from "@/components/v2/v2-post";
import type { ProfileThreadItem } from "@/lib/server/profile-page-data";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";

/*
 * プロフィールの活動。既存の profile-activity.tsx から機能だけを抜いた。
 *
 * 落とさなかったもの: 投稿／返信／メディア／スレッドの4区分（区分は URL）、
 * 固定した投稿を先頭に、本人は固定と解除、投稿と返信は既存の活動APIで
 * 続きを取る（cursor）。投稿1件は v2 のフィードと同じ部品。
 * まだ無いもの: 20件ずつの表示の制御（v2 は取った分を全部出す）。
 */

export type V2ProfileTab = "posts" | "replies" | "media" | "threads";

export function V2ProfileActivity({
  handle,
  tab,
  initialPosts,
  threads,
  pinnedPostId: initialPinned,
  isCurrentUser,
  viewerId,
  locale,
}: {
  handle: string;
  tab: V2ProfileTab;
  initialPosts: V2PostData[];
  threads: ProfileThreadItem[];
  pinnedPostId: string | null;
  isCurrentUser: boolean;
  viewerId: string;
  locale: string;
}) {
  const ja = locale === "ja";
  const [posts, setPosts] = useState(initialPosts);
  const [pinnedPostId, setPinnedPostId] = useState(initialPinned);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(tab === "posts" || tab === "replies");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pinned = posts.find((post) => post.id === pinnedPostId) ?? null;
  const items = posts.filter((post) => post.id !== pinnedPostId).filter((post) => {
    if (tab === "posts") return !post.replyToPostId;
    if (tab === "replies") return Boolean(post.replyToPostId);
    if (tab === "media") return Boolean(post.images?.length);
    return false;
  });

  const loadMore = async () => {
    if (loading || !hasMore || (tab !== "posts" && tab !== "replies")) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ activity: tab, limit: "20" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/profiles/${encodeURIComponent(handle)}/activity?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { posts: V2PostData[]; hasMore: boolean; nextCursor: string | null };
      setPosts((current) => {
        const known = new Set(current.map((post) => post.id));
        return [...current, ...payload.posts.filter((post) => !known.has(post.id))];
      });
      setCursor(payload.nextCursor);
      setHasMore(Boolean(payload.hasMore && payload.nextCursor));
      setError(null);
    } catch {
      setError(ja ? "続きを読み込めませんでした。" : "Could not load more.");
    } finally {
      setLoading(false);
    }
  };

  const togglePin = async (postId: string) => {
    const next = pinnedPostId === postId ? null : postId;
    const before = pinnedPostId;
    setPinnedPostId(next);
    try {
      const response = await fetch("/api/profile/pinned-post", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setError(null);
    } catch {
      setPinnedPostId(before);
      setError(ja ? "固定を変えられませんでした。" : "Could not change the pin.");
    }
  };

  return (
    <div className="v2-profile__activity">
      {error ? <p className="v2-error" role="status">{error}</p> : null}

      {tab === "threads" ? (
        threads.length ? (
          <ul className="v2-tlist">
            {threads.map((thread) => (
              <li key={thread.id} className="v2-tcard">
                <Link className="v2-tcard__title" href={`/v2/threads/${thread.id}`}>{thread.title}</Link>
                <p className="v2-tcard__foot">
                  <span className="v2-tcard__count">{ja ? `${thread.postCount}件の返信` : `${thread.postCount} replies`}</span>
                  <span className="v2-post__time"><V2RelativeTime value={thread.updatedAt} locale={locale} /></span>
                </p>
              </li>
            ))}
          </ul>
        ) : <p className="v2-note">{ja ? "スレッドはまだありません。" : "No threads yet."}</p>
      ) : (
        <>
          {pinned && tab === "posts" ? (
            <div className="v2-profile__pinned">
              <p className="v2-note"><span className="v2-badge">{ja ? "固定" : "Pinned"}</span></p>
              <V2Post post={pinned} viewerId={viewerId} locale={locale} onError={setError} />
              {isCurrentUser ? (
                <div className="v2-profile__tools">
                  <V2Button icon="pin" variant="text" pressed label={ja ? "固定を外す" : "Unpin"} onClick={() => void togglePin(pinned.id)} />
                </div>
              ) : null}
            </div>
          ) : null}
          {items.length ? (
            <div className="v2-feed">
              {items.map((post) => (
                <div key={post.id} className="v2-profile__item">
                  <V2Post post={post} viewerId={viewerId} locale={locale} onError={setError} />
                  {isCurrentUser && tab === "posts" ? (
                    <div className="v2-profile__tools">
                      <V2Button icon="pin" variant="text" label={ja ? "固定する" : "Pin"} onClick={() => void togglePin(post.id)} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="v2-note">
              {tab === "replies" ? (ja ? "返信はまだありません。" : "No replies yet.") : tab === "media" ? (ja ? "画像つきの投稿はまだありません。" : "No media yet.") : (ja ? "投稿はまだありません。" : "No posts yet.")}
            </p>
          )}
          {hasMore && items.length > 0 && (tab === "posts" || tab === "replies") ? (
            <div className="v2-replies__more">
              <button type="button" className="v2-toggle v2-toggle--text" disabled={loading} onClick={() => void loadMore()}>
                {loading ? (ja ? "読み込み中…" : "Loading…") : (ja ? "続きを読む" : "Load more")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
