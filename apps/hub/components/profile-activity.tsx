"use client";

import React, { useMemo, useState } from "react";

import { TweetCard, type TimelinePost } from "@/components/timeline-client";
import type { HubLocale } from "@/lib/i18n";
import type { ProfileThreadItem } from "@/lib/server/profile-page-data";

type ProfileTab = "posts" | "replies" | "media" | "threads";

const TAB_LABELS: Array<{ id: ProfileTab; label: string }> = [
  { id: "posts", label: "投稿" },
  { id: "replies", label: "返信" },
  { id: "media", label: "メディア" },
  { id: "threads", label: "スレッド" },
];

const MEDIA_URL = /https?:\/\/[^\s<]+/giu;
const MEDIA_HOSTS = new Set([
  "imgur.com", "i.imgur.com", "youtube.com", "www.youtube.com", "youtu.be",
  "vimeo.com", "www.vimeo.com", "tiktok.com", "www.tiktok.com",
]);

function hasPublicMedia(post: TimelinePost): boolean {
  const urls = post.body.match(MEDIA_URL) ?? [];
  return urls.some((value) => {
    try {
      const url = new URL(value.replace(/[),.!?、。]+$/u, ""));
      return MEDIA_HOSTS.has(url.hostname.toLocaleLowerCase("en"))
        || /\.(?:avif|gif|jpe?g|png|webp|mp4|webm)$/iu.test(url.pathname);
    } catch {
      return false;
    }
  });
}

function PinButton({
  active,
  busy,
  onClick,
}: {
  active: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`profile-pin-button${active ? " is-active" : ""}`}
      aria-pressed={active}
      disabled={busy}
      onClick={onClick}
    >
      <span aria-hidden="true">⌖</span>{active ? "固定を解除" : "プロフィールに固定"}
    </button>
  );
}

export function ProfileActivity({
  posts,
  profileHandle,
  threads,
  pinnedPostId: initialPinnedPostId,
  isCurrentUser,
  locale,
  viewerProfileId,
}: {
  posts: TimelinePost[];
  profileHandle: string;
  threads: ProfileThreadItem[];
  pinnedPostId: string | null;
  isCurrentUser: boolean;
  locale: HubLocale;
  viewerProfileId: string;
}) {
  const [activityPosts, setActivityPosts] = useState(posts);
  const [tab, setTab] = useState<ProfileTab>("posts");
  /* The page-left column's phone drawer (the shared bbs-* column contract). */
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [pinnedPostId, setPinnedPostId] = useState(initialPinnedPostId);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMessage, setPinMessage] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [activityCursor, setActivityCursor] = useState<Record<"posts" | "replies", string | null>>({ posts: null, replies: null });
  const [activityHasMore, setActivityHasMore] = useState<Record<"posts" | "replies", boolean>>({ posts: true, replies: true });
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const pinnedPost = activityPosts.find((post) => post.id === pinnedPostId) ?? null;
  const allPostItems = useMemo(() => activityPosts.filter((post) => !post.replyToPostId), [activityPosts]);
  const allReplyItems = useMemo(() => activityPosts.filter((post) => Boolean(post.replyToPostId)), [activityPosts]);
  const allMediaItems = useMemo(() => activityPosts.filter(hasPublicMedia), [activityPosts]);
  const postItems = allPostItems.filter((post) => post.id !== pinnedPostId);
  const replyItems = allReplyItems.filter((post) => post.id !== pinnedPostId);
  const mediaItems = allMediaItems.filter((post) => post.id !== pinnedPostId);
  const activePosts = tab === "posts"
    ? postItems
    : tab === "replies"
      ? replyItems
      : tab === "media"
        ? mediaItems
        : [];
  const counts: Record<ProfileTab, number> = {
    posts: allPostItems.length,
    replies: allReplyItems.length,
    media: allMediaItems.length,
    threads: threads.length,
  };

  const updatePinnedPost = async (postId: string | null) => {
    setPinBusy(true);
    setPinMessage("");
    try {
      const response = await fetch("/api/profile/pinned-post", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const payload = await response.json() as { pinnedPostId?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "固定ポストを更新できませんでした。");
      setPinnedPostId(payload.pinnedPostId ?? null);
      setPinMessage(postId ? "プロフィールの先頭に固定しました。" : "固定を解除しました。");
    } catch (error) {
      setPinMessage(error instanceof Error ? error.message : "固定ポストを更新できませんでした。");
    } finally {
      setPinBusy(false);
    }
  };

  const loadMoreActivity = async (kind: "posts" | "replies") => {
    if (activityLoading || !activityHasMore[kind]) return;
    setActivityLoading(true);
    setActivityError("");
    try {
      let cursor = activityCursor[kind];
      let added = 0;
      let hasMore = true;
      for (let attempt = 0; attempt < 2 && added === 0 && hasMore; attempt += 1) {
        const query = new URLSearchParams({ activity: kind, limit: "20" });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(
          `/api/profiles/${encodeURIComponent(profileHandle)}/activity?${query.toString()}`,
          { credentials: "same-origin" },
        );
        const payload = await response.json().catch(() => ({})) as {
          posts?: TimelinePost[];
          nextCursor?: string | null;
          hasMore?: boolean;
          error?: string;
        };
        if (!response.ok || !payload.posts) {
          throw new Error(payload.error ?? "profile_activity_failed");
        }
        const knownIds = new Set(activityPosts.map((post) => post.id));
        const fresh = payload.posts.filter((post) => !knownIds.has(post.id));
        added += fresh.length;
        if (fresh.length) {
          setActivityPosts((current) => [
            ...current,
            ...fresh.filter((post) => !current.some((item) => item.id === post.id)),
          ]);
        }
        cursor = payload.nextCursor ?? null;
        hasMore = Boolean(payload.hasMore && cursor);
      }
      setActivityCursor((current) => ({ ...current, [kind]: cursor }));
      setActivityHasMore((current) => ({ ...current, [kind]: hasMore }));
      setVisibleCount((count) => count + Math.max(20, added));
    } catch {
      setActivityError("追加の投稿を読み込めませんでした。もう一度お試しください。");
    } finally {
      setActivityLoading(false);
    }
  };

  const renderPost = (post: TimelinePost, pinned = false) => (
    <div className={`profile-activity-post${pinned ? " profile-activity-post--pinned" : ""}`} key={post.id}>
      {pinned ? <div className="profile-pinned-label"><span aria-hidden="true">⌖</span>固定ポスト</div> : null}
      <TweetCard post={post} locale={locale} viewerProfileId={viewerProfileId} />
      {isCurrentUser && !post.replyToPostId ? (
        <PinButton
          active={pinnedPostId === post.id}
          busy={pinBusy}
          onClick={() => void updatePinnedPost(pinnedPostId === post.id ? null : post.id)}
        />
      ) : null}
    </div>
  );

  /*
   * Four-region layout: the activity switcher lives in the page-left column
   * through the shared bbs-* column contract, like the feed and the search.
   */
  return (
    <div className="profile-directory-layout bbs-directory-layout tab-left-column-layout">
      <button
        type="button"
        className="bbs-directory-mobile-toggle"
        onClick={() => setDirectoryOpen((open) => !open)}
        aria-controls="profile-activity-directory"
        aria-expanded={directoryOpen}
      >
        活動の切替
      </button>
      {directoryOpen ? (
        <button type="button" className="bbs-directory-backdrop" onClick={() => setDirectoryOpen(false)} aria-label="閉じる" />
      ) : null}
      <aside
        id="profile-activity-directory"
        data-hub-page-left-column
        className={`profile-activity-directory bbs-thread-directory tab-left-column${directoryOpen ? " bbs-thread-directory--open" : ""}`}
        aria-label="プロフィールの活動"
      >
        <header className="bbs-thread-directory__header tab-left-column__header">
          <div>
            <strong>活動</strong>
          </div>
          <button type="button" onClick={() => setDirectoryOpen(false)} aria-label="閉じる">×</button>
        </header>
        <nav className="bbs-thread-directory__nav feed-directory__nav" role="tablist" aria-label="プロフィールの活動">
          {TAB_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`tl-tab${tab === item.id ? " tl-tab--active" : ""}`}
              onClick={() => { setTab(item.id); setVisibleCount(20); setDirectoryOpen(false); }}
            >
              {item.label}<span className="feed-directory__count">{counts[item.id]}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="profile-directory-content bbs-directory-content">
    <section className="profile-posts-simple">
      {pinnedPost ? <div className="profile-pinned-post">{renderPost(pinnedPost, true)}</div> : null}
      <p className="profile-pin-message" aria-live="polite">{pinMessage}</p>
      <p className="profile-pin-message" aria-live="polite">{activityError}</p>

      <div role="tabpanel" className="profile-activity-panel">
        {tab === "threads" ? (
          threads.length ? (
            <div className="profile-thread-list">
              {threads.slice(0, visibleCount).map((thread) => (
                <a key={thread.id} href={`/threads/${thread.id}`} className="profile-thread-item">
                  <span>{thread.boardKey}</span>
                  <strong>{thread.title}</strong>
                  <small>{thread.postCount}件の投稿</small>
                </a>
              ))}
            </div>
          ) : <div className="empty-state"><p>作成したスレッドはまだありません</p></div>
        ) : activePosts.length ? (
          <div className="home-feed__stream profile-posts-feed">{activePosts.slice(0, visibleCount).map((post) => renderPost(post))}</div>
        ) : (
          <div className="empty-state"><p>{tab === "replies" ? "返信はまだありません" : tab === "media" ? "メディア付きの投稿はまだありません" : "まだ投稿がありません"}</p></div>
        )}
        {tab === "posts" || tab === "replies" ? (
          activityHasMore[tab] ? (
            <div className="search-load-more">
              <button
                type="button"
                disabled={activityLoading}
                onClick={() => void loadMoreActivity(tab)}
              >
                {activityLoading ? "読み込み中…" : "もっと見る"}
              </button>
            </div>
          ) : null
        ) : (tab === "threads" ? threads.length : activePosts.length) > visibleCount ? (
          <div className="search-load-more"><button type="button" onClick={() => setVisibleCount((count) => Math.min(100, count + 20))}>もっと見る</button><small>{visibleCount} / {tab === "threads" ? threads.length : activePosts.length}</small></div>
        ) : null}
      </div>
    </section>
      </div>
    </div>
  );
}
