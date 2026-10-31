"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Skeleton, useToast } from "@/components/v2/ui";
import { V2Button } from "@/components/v2/v2-button";
import { V2Icon } from "@/components/v2/v2-icons";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2State } from "@/components/v2/v2-state";
import { V2Compose } from "@/components/v2/v2-compose";
import { V2Post } from "@/components/v2/v2-post";
import type { AppShellTimelinePost } from "@/lib/server/app-shell-data";
import { useHubRecommendations } from "@/lib/use-hub-recommendations";
import { discoveryMatchingInterest, rankDiscoveryItems } from "@/lib/discovery-recommendations";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";
import { useHubNetwork, HubNetworkCard, HubNetworkStatus } from "@/components/hub-network";
import { PublicPostPeerStatus } from "@/components/public-post-peer-status";
import { interleaveHubItems } from "@/lib/hub-network-client";
import { V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";

/*
 * v2 のフィード。既存の timeline-client.tsx（3,384行）とは別物で、既存には触れない。
 *
 * 持っているもの: 投稿欄（先頭。送れたら一覧の先頭に足す）、4つの並び
 * （ページ側の ?feed= で選ぶ）、取り足し（既存と同じ /api/social/posts?view=timeline）。
 *
 * **ここに無いものを先に書いておく。** 既存のフィードは、引用・リポスト・編集・削除・
 * 通報・ミュート・ブロック・翻訳・外部リンクカード・広告・連合・予約投稿・
 * クロスポスト・無限スクロール・未読の区切りを持つ。v2はまだ持たない。
 * 一覧はここ、投稿1件の見た目は v2-post.tsx。投稿詳細も同じカードを使う。
 */

const PAGE_SIZE = 40;

function recommendationAuthor(post: AppShellTimelinePost) {
  return post.identityMode === "account" && post.authorProfileId ? `profile:${post.authorProfileId}` : null;
}

type Props = {
  posts: AppShellTimelinePost[];
  scope: "recommended" | "latest" | "popular" | "following";
  viewerId: string;
  viewerName: string;
  viewerAvatarUrl?: string;
  /*
   * Hubは15言語を持つ。ここでは日本語かどうかだけを見て、それ以外は英語に倒す。
   * 15言語ぶんの文言はまだ無いので、あるふりをしない。
   */
  locale: string;
  shareHref?: string;
  /* おすすめ/人気の候補が無く、新しい順で代わりに出している。 */
  fallbackNote?: boolean;
};

export function V2Feed({ posts: initialPosts, scope, viewerId, viewerName, viewerAvatarUrl, locale, shareHref, fallbackNote }: Props) {
  const ja = locale === "ja";
  const network = useHubNetwork('post', Boolean(viewerId) && (scope === 'recommended' || scope === 'latest'));
  const [posts, setPosts] = useState(initialPosts);
  const { interests } = useHubRecommendations();
  const feedback = useDiscoveryFeedback("feed");
  const visiblePosts = scope === "recommended"
    ? rankDiscoveryItems(posts.filter(post => !feedback.isHidden(post.id)), interests, post => ({ text: post.body, author: recommendationAuthor(post) ?? undefined }))
      .sort((a, b) => Number(Boolean(recommendationAuthor(a) && feedback.isAuthorReduced(recommendationAuthor(a)!))) - Number(Boolean(recommendationAuthor(b) && feedback.isAuthorReduced(recommendationAuthor(b)!))))
    : posts;
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  /* 失敗の通知はトースト（SPEC 3）。null は「消す」なので何もしない。 */
  const setError = useCallback((message: string | null) => {
    if (message) toastRef.current.show({ message });
  }, []);
  const [page, setPage] = useState<{ offset: number; cursor: string | null; hasMore: boolean; loading: boolean }>({
    offset: initialPosts.length,
    cursor: null,
    hasMore: initialPosts.length >= PAGE_SIZE,
    loading: false,
  });

  const loadingRef = useRef(false);
  const [stalled, setStalled] = useState(false);
  const topRef = useRef<HTMLSpanElement | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const prepend = (post: AppShellTimelinePost) => {
    setPosts((current) => current.some((item) => item.id === post.id) ? current : [post, ...current]);
  };

  /*
   * 新着の知らせ。45秒ごとに先頭10件を取り、手元に無いものがあれば数だけ告げる。
   * 勝手に差し込むと読んでいる行が動くので、押したときに先頭へ足す。
   * 見えていないタブでは取らない。既存のフィードも同じ間隔だった。
   */
  const [fresh, setFresh] = useState<AppShellTimelinePost[]>([]);
  const postsRef = useRef(posts);
  useEffect(() => { postsRef.current = posts; }, [posts]);
  useEffect(() => {
    if (scope === "popular" || scope === "recommended") return;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const params = new URLSearchParams({ view: "timeline", feed: scope, limit: "10", offset: "0" });
        const response = await fetch(`/api/social/posts?${params.toString()}`, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const payload = await response.json() as { posts?: AppShellTimelinePost[] };
        if (cancelled || !payload.posts) return;
        const known = new Set(postsRef.current.map((item) => item.id));
        setFresh(payload.posts.filter((item) => !known.has(item.id)));
      } catch {
        /* 次の周で取り直す。 */
      }
    };
    const timer = window.setInterval(() => void check(), 45_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [scope]);

  /*
   * 未読の区切り。前回この並びを開いたときの先頭の投稿を端末に覚え、
   * 今回の一覧でその投稿の直前に線を引く。先頭が同じなら線は出ない。
   */
  const [seenId, setSeenId] = useState<string | null>(null);
  /*
   * 読むのは1回だけ。開発中の React は効果を2回走らせるので、読んで書いた直後に
   * もう一度読むと「前回の先頭」が今回の先頭に化けて線が消える。
   */
  const seenOnce = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const key = `hub.v2.feed-seen.${scope}`;
    try {
      if (seenOnce.current === undefined) seenOnce.current = window.localStorage.getItem(key);
      setSeenId(seenOnce.current);
      if (initialPosts[0]) window.localStorage.setItem(key, initialPosts[0].id);
    } catch {
      /* 覚えられなければ線を引かないだけ。 */
    }
  }, [scope, initialPosts]);
  const unreadBoundary = seenId ? posts.findIndex((item) => item.id === seenId) : -1;

  const showFresh = () => {
    setPosts((current) => {
      const known = new Set(current.map((item) => item.id));
      return [...fresh.filter((item) => !known.has(item.id)), ...current];
    });
    setFresh([]);
    /* 文書でも入れ子の枠でも、先頭の目印を見える位置へ。 */
    topRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const loadMore = async () => {
    if (loadingRef.current || !page.hasMore) return;
    loadingRef.current = true;
    setStalled(false);
    setPage((current) => ({ ...current, loading: true }));
    try {
      const params = new URLSearchParams({ view: "timeline", feed: scope, limit: String(PAGE_SIZE), offset: String(page.offset) });
      if (page.cursor) params.set("cursor", page.cursor);
      const response = await fetch(`/api/social/posts?${params.toString()}`, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => null) as { posts?: AppShellTimelinePost[]; hasMore?: boolean; nextCursor?: string | null; nextOffset?: number; error?: string } | null;
      if (!response.ok || !payload?.posts) throw new Error(payload?.error || String(response.status));
      const fresh = payload.posts;
      setPosts((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...fresh.filter((item) => !seen.has(item.id))];
      });
      setPage({
        offset: payload.nextOffset ?? page.offset + fresh.length,
        cursor: payload.nextCursor ?? null,
        hasMore: Boolean(payload.hasMore) && fresh.length > 0,
        loading: false,
      });
      setError(null);
    } catch (caught) {
      setPage((current) => ({ ...current, loading: false }));
      /* 失敗したまま自動で読み直すと止まらない。ここで止めて、押して再開する。 */
      setStalled(true);
      setError(caught instanceof Error && caught.message ? caught.message : (ja ? "続きを取得できませんでした。" : "Could not load more."));
    } finally {
      loadingRef.current = false;
    }
  };

  /*
   * 自動で続きを読む。一覧の末尾の目印が下端の600px手前に入ったら取る。
   * 追加は下へ足すだけなので、読んでいる位置は動かない。IntersectionObserver が
   * 無い環境と、失敗で止まったときだけ、押して読み込む札を出す。
   */
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const hasObserver = typeof IntersectionObserver !== "undefined";
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !page.hasMore || stalled || !hasObserver) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current();
    }, { rootMargin: "0px 0px 600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [page.hasMore, page.offset, stalled, hasObserver]);

  const reasonFor = (text: string) => {
    const match = discoveryMatchingInterest(text, interests);
    return match
      ? (ja ? `関心のある「${match}」に関連しています。` : `Related to your interest in ${match}.`)
      : (ja ? "表示できる投稿から紹介しています。" : "Selected from available posts.");
  };

  return (
    <>
      <span ref={topRef} className="v2-feed__top" aria-hidden="true" />
      {viewerId ? (
        <V2Compose viewerId={viewerId} viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} japanese={ja} onCreated={prepend} shareHref={shareHref} />
      ) : null}
      {fallbackNote ? <p className="v2-note">{ja ? "いま並べられるおすすめがないため、新しい順で表示しています。" : "No recommendations to rank right now, so posts are shown newest first."}</p> : null}
      {scope === "recommended" ? <V2DiscoveryFeedbackStatus feedback={feedback} japanese={ja} /> : null}
      {scope === "recommended" && posts.length > 0 && !visiblePosts.length ? <p className="v2-note">{ja ? "読み込み済みのおすすめは非表示になっています。続きを読み込むか、別の並び順や設定のリセットから再表示できます。" : "Loaded recommendations are hidden. Load more, choose another feed, or reset hidden recommendations in settings."}</p> : null}
      {/* 新着の札。高さ0の帯の中に浮かせるので、出ても下の行は動かない。 */}
      <div className="v2-feed__fresh" aria-live="polite">
        {fresh.length ? (
          <button type="button" className="v2-feed__fresh-pill" onClick={showFresh}>
            <V2Icon name="chevron-down" className="v2-feed__fresh-icon" />
            {ja ? `新しい投稿 ${fresh.length}件` : `${fresh.length} new posts`}
          </button>
        ) : null}
      </div>
      <HubNetworkStatus state={network} />
      {network.count>0?<PublicPostPeerStatus/>:null}
      {posts.length || network.items.length ? (
        <div className="v2-feed">
          {interleaveHubItems(visiblePosts, network.items).map((entry) => {
            if(entry.remote) return <HubNetworkCard key={`${entry.remote.origin}:${entry.remote.id}`} item={entry.remote} />;
            const post = entry.local;
            const index = visiblePosts.indexOf(post);
            const author = recommendationAuthor(post);
            return (
            <div key={post.id} className="v2-feed__row">
              {scope !== "recommended" && unreadBoundary > 0 && index === unreadBoundary ? (
                <p className="v2-unread-line"><span>{ja ? "ここまで未読" : "New above"}</span></p>
              ) : null}
              <V2Post
                post={post}
                viewerId={viewerId}
                locale={locale}
                onError={setError}
                onCreated={prepend}
                onRemoved={(postId) => setPosts((current) => current.filter((item) => item.id !== postId))}
                discovery={scope === "recommended" ? {
                  reason: reasonFor(post.body),
                  dismiss: () => feedback.dismiss(post.id),
                  reduceAuthor: author ? () => feedback.reduceAuthor(author) : undefined,
                  restoreAuthor: author && feedback.isAuthorReduced(author) ? () => feedback.restoreAuthor(author) : undefined,
                } : undefined}
              />
            </div>
          );})}
        </div>
      ) : (
        scope === "following"
          ? <V2Empty title={ja ? "フォローしている人の投稿はまだありません" : "Nothing from people you follow yet"} note={ja ? "気になる人をフォローすると、ここに並びます。" : "Follow people and their posts show up here."} action={{ label: ja ? "人を探す" : "Find people", href: "/v2/search?q=%E4%BA%BA" }} />
          : viewerId
            ? <V2Empty title={ja ? "まだ投稿がありません" : "No posts yet"} action={{ label: ja ? "最初の1件を書く" : "Write the first post", href: "#compose" }} />
            : <V2State kind="signedOut" icon="home" next="/v2" japanese={ja} title={ja ? "ログインして投稿を見る" : "Sign in to see posts"} note={ja ? "ログインすると、フォローした人の投稿が並びます。" : "Sign in to see posts from people you follow."} secondaryAction={{ label: ja ? "人気を見る" : "See popular", href: "/v2?feed=popular" }} />
      )}
      {page.hasMore ? (
        <div className="v2-feed__more" ref={sentinel}>
          {page.loading && hasObserver ? <Skeleton kind="post" count={2} label={ja ? "読み込んでいます" : "Loading"} /> : null}
          {!hasObserver || stalled ? (
            <V2Button variant="text" label={page.loading ? (ja ? "読み込んでいます…" : "Loading…") : stalled ? (ja ? "もう一度読み込む" : "Try again") : (ja ? "もっと見る" : "Load more")} disabled={page.loading} onClick={() => void loadMore()} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
