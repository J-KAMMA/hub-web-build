"use client";

import React from "react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { SearchSubmitButton } from "@/components/search-submit-button";
import { TweetCard, type TimelinePost } from "@/components/timeline-client";
import { hubpediaArticleHref } from "@/lib/hubpedia-navigation";
import type { HubLocale } from "@/lib/i18n";
import { hubUi } from "@/lib/ui-copy";
import { scoreSearchFields } from "@/lib/search-relevance";
import type { SearchDiscoveryData } from "@/lib/server/search-page-data";
import {
  hubPersonalizationEnabled,
  readHubInterestProfile,
  recordHubInterests,
  topHubInterests,
} from "@/lib/hub-interest-profile";
import {
  imageInterestTerms,
  rankHubImages,
  readHubImageHistory,
  rememberHubImage,
} from "@/lib/image-recommendation";
import { isMockImagePost, MOCK_IMAGE_COMMENTS } from "@/lib/mock-image-posts";
import {
  FirstPartyAdSlot,
  type ServedAd,
} from "@/components/first-party-ad-slot";
import { CommunityTrends } from "@/components/community-trends";
import type { RankingPageData } from "@/lib/server/ranking-page-data";
import { localizedText } from "@/lib/localized-text";
import { HubActionCard } from "@/components/hub-action-card";
import {
  createHubActionProjection,
  publicResourceToken,
} from "@/lib/action-layer";
import {
  workActionProjection,
} from "@/lib/action-projections";
import { listingMarketProjection } from "@/lib/specialist-market-projection";
import { useHubSurfaceNavigation } from "@/lib/use-hub-surface-navigation";

type SearchTrends = Pick<
  RankingPageData,
  | "threadRanking"
  | "socialRanking"
  | "hubpediaRanking"
  | "tokenRanking"
  | "communityRanking"
>;

type SearchPost = {
  id: string;
  displayName: string;
  handle?: string | null;
  body: string;
  identityMode?: TimelinePost["identityMode"];
  createdAt?: string;
  productHref?: string;
} & Partial<TimelinePost>;

type Payload = {
  counts: {
    boards: number;
    profiles: number;
    threads: number;
    posts: number;
    images: number;
    hubpedia: number;
    communities: number;
    videos: number;
    products: number;
    lists: number;
    tokens: number;
    work: number;
    listings: number;
    music: number;
  };
  boards: Array<{
    id: string;
    key: string;
    title: string;
    threadCount: number;
  }>;
  profiles: Array<{
    id: string;
    handle: string;
    displayName: string;
    bio: string;
    avatarUrl?: string | null;
  }>;
  threads: Array<{ id: string; title: string; postCount: number }>;
  posts: SearchPost[];
  images: SearchPost[];
  hubpedia: Array<{
    slug: string;
    title: string;
    category: string;
    summary: string;
    href: string;
  }>;
  communities: Array<{
    id: string;
    slug: string;
    name: string;
    description: string;
    category: string;
  }>;
  videos: Array<{
    id: string;
    title: string;
    channel: string;
    category: string;
    topic: string;
    provider: string;
  }>;
  products: Array<{
    id: string;
    title: string;
    description: string;
    category: string;
    seller: string;
    price: number;
    currency: string;
  }>;
  lists: Array<{ id: string; name: string; description: string }>;
  tokens: Array<{
    id: string;
    title: string;
    symbol: string;
    network: string;
    description: string;
  }>;
  work: Array<{
    id: string;
    kind: "job" | "project" | "service";
    title: string;
    organization: string;
    summary: string;
    location: string;
    compensation: string;
    tags: string[];
  }>;
  listings: Array<{
    id: string;
    kind: "travel" | "local-services" | "classes" | "events";
    title: string;
    summary: string;
    category: string;
    providerLabel: string;
    providerUrl: string;
    region: string;
    locality: string;
    priceLabel: string | null;
    trustStatus: "verified" | "pending" | "not_available";
    updatedAt: string;
  }>;
  music: Array<{
    id: string;
    title: string;
    artist: string;
    description: string;
  }>;
};

type Filter =
  | "all"
  | "profiles"
  | "posts"
  | "threads"
  | "boards"
  | "images"
  | "videos"
  | "products"
  | "tokens"
  | "work"
  | "listings"
  | "music"
  | "communities"
  | "hubpedia"
  | "lists";
type HubResultKind = Exclude<Filter, "all">;
type SearchOrder = "relevant" | "popular" | "newest";
type CorePayload = Omit<Payload, "counts" | "music"> & {
  counts: Omit<Payload["counts"], "music">;
};
const EMPTY: Payload = {
  counts: {
    boards: 0,
    profiles: 0,
    threads: 0,
    posts: 0,
    images: 0,
    hubpedia: 0,
    communities: 0,
    videos: 0,
    products: 0,
    lists: 0,
    tokens: 0,
    work: 0,
    listings: 0,
    music: 0,
  },
  boards: [],
  profiles: [],
  threads: [],
  posts: [],
  images: [],
  hubpedia: [],
  communities: [],
  videos: [],
  products: [],
  lists: [],
  tokens: [],
  work: [],
  listings: [],
  music: [],
};

function matchesExternalSearch(parts: string[], query: string) {
  const terms = query
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .split(/\s+/u)
    .filter(Boolean);
  const text = parts.join(" ").normalize("NFKC").toLocaleLowerCase("ja");
  return terms.every((term) => text.includes(term));
}

function toTimelinePost(post: SearchPost): TimelinePost {
  return {
    ...post,
    authorProfileId: post.authorProfileId ?? null,
    handle: post.handle ?? undefined,
    identityMode: post.identityMode ?? "guest",
    createdAt: post.createdAt ?? new Date(0).toISOString(),
    replyToPostId: post.replyToPostId ?? null,
    repostOfTargetType: post.repostOfTargetType ?? null,
    repostOfTargetId: post.repostOfTargetId ?? null,
    quoteOfTargetType: post.quoteOfTargetType ?? null,
    quoteOfTargetId: post.quoteOfTargetId ?? null,
    replyCount: post.replyCount ?? 0,
    repostCount: post.repostCount ?? 0,
    quoteRepostCount: post.quoteRepostCount ?? 0,
    likeCount: post.likeCount ?? 0,
    score: post.score ?? 0,
    bookmarked: post.bookmarked ?? false,
    viewerReaction: post.viewerReaction ?? null,
    referenced: post.referenced ?? null,
  };
}

function PinterestImageGrid({
  posts,
  locale,
  viewerProfileId,
  onSignal,
}: {
  posts: SearchPost[];
  locale: HubLocale;
  viewerProfileId: string;
  onSignal: () => void;
}) {
  const navigateHubRoute = useHubSurfaceNavigation();
  const [saved, setSaved] = useState(
    () =>
      new Set(posts.filter((post) => post.bookmarked).map((post) => post.id)),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    post: SearchPost;
    image: NonNullable<SearchPost["images"]>[number];
  } | null>(null);
  const [comments, setComments] = useState<SearchPost[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [liked, setLiked] = useState(
    () =>
      new Set(
        posts
          .filter((post) => post.viewerReaction === "like")
          .map((post) => post.id),
      ),
  );
  const [imageActionBusy, setImageActionBusy] = useState<string | null>(null);
  const [imageActionNotice, setImageActionNotice] = useState("");
  const imageWheelTotal = useRef(0);
  const imageWheelLocked = useRef(false);
  const imageTouchStartY = useRef<number | null>(null);
  const imageVisual = useRef<HTMLDivElement>(null);
  const pins = posts.flatMap((post) =>
    (post.images ?? []).map((image) => ({ post, image })),
  );
  const adKeywords = [
    ...new Set(posts.flatMap((post) => imageInterestTerms(post))),
  ].slice(0, 20);
  const keywordText = adKeywords.join(" ").toLocaleLowerCase("ja");
  const adInsertAfter = pins.length >= 6 ? 4 : pins.length >= 3 ? 1 : -1;
  const developmentAd: ServedAd =
    keywordText.includes("食") ||
    keywordText.includes("料理") ||
    keywordText.includes("野菜")
      ? {
          label: "広告・モック",
          advertiserDisplayName: "Hub Kitchen",
          headline: "季節の食材を見つける",
          description: "画像の内容に近い商品や特集を紹介します。",
          imagePath: "/mock-images/seasonal-lunch.avif",
          altText: "季節の食材を使った昼食",
          callToAction: "マーケットを見る",
          clickUrl: "/market",
          aboutUrl: "/privacy",
        }
      : keywordText.includes("雨") ||
          keywordText.includes("街") ||
          keywordText.includes("写真")
        ? {
            label: "広告・モック",
            advertiserDisplayName: "Hub Photo",
            headline: "夜の写真を楽しむ",
            description: "街歩きと撮影に合うアイテムを紹介します。",
            imagePath: "/mock-images/rainy-street.avif",
            altText: "雨上がりの街の写真",
            callToAction: "関連商品を見る",
            clickUrl: "/market",
            aboutUrl: "/privacy",
          }
        : {
            label: "広告・モック",
            advertiserDisplayName: "Hub Reading",
            headline: "読書の時間を整える",
            description: "本と音楽のある空間に合うアイテムを紹介します。",
            imagePath: "/mock-images/reading-desk.avif",
            altText: "本と音楽のある読書机",
            callToAction: "関連商品を見る",
            clickUrl: "/market",
            aboutUrl: "/privacy",
          };
  const related = selected
    ? rankHubImages(
        posts.filter((post) => post.id !== selected.post.id),
        {
          interests: imageInterestTerms(selected.post),
          historyIds: [],
          queryActive: false,
        },
      ).slice(0, 6)
    : [];

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setCommentsLoading(true);
    fetch("/api/social/posts", { signal: controller.signal })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ posts?: SearchPost[] }>)
          : null,
      )
      .then((payload) =>
        setComments([
          ...(payload?.posts ?? []).filter(
            (post) => post.replyToPostId === selected.post.id,
          ),
          ...(MOCK_IMAGE_COMMENTS[selected.post.id] ?? []),
        ]),
      )
      .catch((error) => {
        if (error.name !== "AbortError") setComments([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCommentsLoading(false);
      });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      controller.abort();
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selected?.post.id]);

  useEffect(() => {
    const visual = imageVisual.current;
    if (!selected || !visual) return;
    const onWheel = (event: WheelEvent) => handleImageWheel(event);
    visual.addEventListener("wheel", onWheel, { passive: false });
    return () => visual.removeEventListener("wheel", onWheel);
  }, [selected?.post.id, selected?.image.id, pins.length]);

  async function toggleSaved(postId: string) {
    if (!viewerProfileId || busy) return;
    const active = !saved.has(postId);
    setBusy(postId);
    try {
      const response = await fetch("/api/engagements/bookmark", {
        method: active ? "PUT" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_type: "social_post",
          target_id: postId,
          active,
        }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        summary?: { bookmarked?: boolean };
      };
      setSaved((current) => {
        const next = new Set(current);
        if (payload.summary?.bookmarked) next.add(postId);
        else next.delete(postId);
        return next;
      });
      const post = posts.find((candidate) => candidate.id === postId);
      if (payload.summary?.bookmarked && post)
        recordHubInterests("image", imageInterestTerms(post), 4);
      if (post) rememberHubImage(window.localStorage, post.id);
      onSignal();
    } finally {
      setBusy(null);
    }
  }

  function openImage(
    post: SearchPost,
    image: NonNullable<SearchPost["images"]>[number],
  ) {
    if (post.productHref) {
      navigateHubRoute(post.productHref);
      return;
    }
    rememberHubImage(window.localStorage, post.id);
    recordHubInterests("image", imageInterestTerms(post), 1);
    setSelected({ post, image });
    setCommentDraft("");
    setImageActionNotice("");
    onSignal();
  }

  async function toggleImageLike() {
    if (!selected || !viewerProfileId || imageActionBusy) return;
    const active = !liked.has(selected.post.id);
    setImageActionBusy("like");
    setImageActionNotice("");
    try {
      const response = await fetch("/api/engagements/reaction", {
        method: active ? "PUT" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_type: "social_post",
          target_id: selected.post.id,
          kind: "like",
          active,
        }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        summary?: { viewerReaction?: "like" | null };
      };
      setLiked((current) => {
        const next = new Set(current);
        if (payload.summary?.viewerReaction === "like")
          next.add(selected.post.id);
        else next.delete(selected.post.id);
        return next;
      });
      recordHubInterests("image", imageInterestTerms(selected.post), 2);
      onSignal();
    } finally {
      setImageActionBusy(null);
    }
  }

  async function shareImage() {
    if (!selected) return;
    const url = new URL(
      `/posts/${encodeURIComponent(selected.post.id)}`,
      window.location.origin,
    ).toString();
    try {
      if (navigator.share)
        await navigator.share({
          title: selected.post.body || selected.post.displayName,
          url,
        });
      else await navigator.clipboard.writeText(url);
      setImageActionNotice(
        locale === "ja" ? "共有リンクを用意しました。" : "Share link ready.",
      );
    } catch {
      /* The user may cancel the platform share sheet. */
    }
  }

  async function reportImage() {
    if (
      !selected ||
      !viewerProfileId ||
      imageActionBusy ||
      isMockImagePost(selected.post.id)
    )
      return;
    setImageActionBusy("report");
    setImageActionNotice("");
    try {
      const response = await fetch(
        `/api/social/posts/${encodeURIComponent(selected.post.id)}/report`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "image_safety" }),
        },
      );
      if (response.ok)
        setImageActionNotice(
          locale === "ja" ? "通報を受け付けました。" : "Report received.",
        );
    } finally {
      setImageActionBusy(null);
    }
  }

  function moveImage(direction: -1 | 1) {
    if (!selected || pins.length < 2) return;
    const currentIndex = pins.findIndex(
      ({ post, image }) =>
        post.id === selected.post.id && image.id === selected.image.id,
    );
    const nextIndex = Math.min(
      pins.length - 1,
      Math.max(0, currentIndex + direction),
    );
    if (nextIndex === currentIndex) return;
    const next = pins[nextIndex];
    if (next) openImage(next.post, next.image);
  }

  function handleImageWheel(
    event: Pick<WheelEvent, "deltaX" | "deltaY" | "preventDefault">,
  ) {
    if (
      imageWheelLocked.current ||
      Math.abs(event.deltaY) < Math.abs(event.deltaX)
    )
      return;
    imageWheelTotal.current += event.deltaY;
    if (Math.abs(imageWheelTotal.current) < 55) return;
    event.preventDefault();
    moveImage(imageWheelTotal.current > 0 ? 1 : -1);
    imageWheelTotal.current = 0;
    imageWheelLocked.current = true;
    window.setTimeout(() => {
      imageWheelLocked.current = false;
    }, 360);
  }

  function handleImageTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const startY = imageTouchStartY.current;
    imageTouchStartY.current = null;
    if (startY === null) return;
    const endY = event.changedTouches[0]?.clientY;
    if (endY === undefined || Math.abs(startY - endY) < 45) return;
    moveImage(startY > endY ? 1 : -1);
  }

  async function submitComment() {
    const body = commentDraft.trim();
    if (!selected || !viewerProfileId || !body || commentBusy) return;
    setCommentBusy(true);
    try {
      if (isMockImagePost(selected.post.id)) {
        setComments((current) => [
          ...current,
          {
            id: `mock-comment-local-${Date.now()}`,
            displayName: locale === "ja" ? "あなた" : "You",
            body,
            identityMode: "account",
            createdAt: new Date().toISOString(),
            replyToPostId: selected.post.id,
          },
        ]);
        setCommentDraft("");
        return;
      }
      const response = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body,
          identity_mode: "account",
          reply_to_post_id: selected.post.id,
        }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { post?: SearchPost };
      if (payload.post) setComments((current) => [...current, payload.post!]);
      setCommentDraft("");
    } finally {
      setCommentBusy(false);
    }
  }

  return (
    <div className="pinterest-image-grid search-image-results">
      {pins.map(({ post, image }, index) => {
        return (
          <React.Fragment key={`${post.id}:${image.id}`}>
            <article className="pinterest-image-card">
              <div className="pinterest-image-card__media">
                <button
                  type="button"
                  className="pinterest-image-card__open"
                  aria-label={`${post.displayName}: ${image.altText || post.body}`}
                  onClick={() => openImage(post, image)}
                >
                  <img
                    src={image.url}
                    width={image.width}
                    height={image.height}
                    alt={image.altText || post.body}
                    loading="lazy"
                  />
                </button>
              </div>
              <div className="pinterest-image-card__caption">
                {post.body ? (
                  <a href={`/posts/${encodeURIComponent(post.id)}`}>
                    <strong>{post.body}</strong>
                  </a>
                ) : null}
                <a
                  href={
                    post.handle
                      ? `/profile/${encodeURIComponent(post.handle)}`
                      : `/posts/${encodeURIComponent(post.id)}`
                  }
                  className="pinterest-image-card__author"
                >
                  <span aria-hidden="true">{post.displayName.slice(0, 1)}</span>
                  <b>{post.displayName}</b>
                </a>
              </div>
            </article>
            {index === adInsertAfter ? (
              <FirstPartyAdSlot
                placementKey="search.images.inline"
                variant="image-grid"
                developmentFallback={developmentAd}
                context={{
                  pageType: "image_search",
                  pageCategory: "images",
                  contentTags: adKeywords.slice(0, 8),
                  contentKeywords: adKeywords,
                  language: locale,
                }}
              />
            ) : null}
          </React.Fragment>
        );
      })}
      {selected ? (
        <div
          className="image-viewer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <section
            className="image-viewer-app"
            role="dialog"
            aria-modal="true"
            aria-label={locale === "ja" ? "画像ビューア" : "Image viewer"}
          >
            <button
              type="button"
              className="image-viewer-app__close"
              onClick={() => setSelected(null)}
              autoFocus
              aria-label={locale === "ja" ? "閉じる" : "Close"}
            >
              ×
            </button>
            <div
              ref={imageVisual}
              className="image-viewer-app__visual"
              onTouchStart={(event) => {
                imageTouchStartY.current = event.touches[0]?.clientY ?? null;
              }}
              onTouchEnd={handleImageTouchEnd}
            >
              <img
                src={selected.image.url}
                width={selected.image.width}
                height={selected.image.height}
                alt={selected.image.altText || selected.post.body}
              />
              <span className="image-viewer-app__position" aria-live="polite">
                {pins.findIndex(
                  ({ post, image }) =>
                    post.id === selected.post.id &&
                    image.id === selected.image.id,
                ) + 1}{" "}
                / {pins.length}
              </span>
            </div>
            <aside className="image-viewer-app__panel">
              <header>
                <div className="image-viewer-app__author-row">
                  <a
                    className="image-viewer-app__author"
                    href={
                      selected.post.handle
                        ? `/profile/${encodeURIComponent(selected.post.handle)}`
                        : `/posts/${encodeURIComponent(selected.post.id)}`
                    }
                  >
                    <strong>{selected.post.displayName}</strong>
                    {selected.post.handle ? (
                      <span>@{selected.post.handle}</span>
                    ) : null}
                  </a>
                  <button
                    type="button"
                    className={`image-viewer-app__save${saved.has(selected.post.id) ? " is-saved" : ""}`}
                    disabled={!viewerProfileId || busy === selected.post.id}
                    onClick={() => void toggleSaved(selected.post.id)}
                  >
                    {saved.has(selected.post.id)
                      ? locale === "ja"
                        ? "保存済み"
                        : "Saved"
                      : locale === "ja"
                        ? "保存"
                        : "Save"}
                  </button>
                </div>
                <p>{selected.post.body}</p>
                <div className="image-viewer-app__actions">
                  <button
                    type="button"
                    className={liked.has(selected.post.id) ? "is-active" : ""}
                    disabled={!viewerProfileId || Boolean(imageActionBusy)}
                    onClick={() => void toggleImageLike()}
                  >
                    {locale === "ja" ? "いいね" : "Like"}{" "}
                    {selected.post.likeCount ?? 0}
                  </button>
                  <button type="button" onClick={() => void shareImage()}>
                    {locale === "ja" ? "共有" : "Share"}
                  </button>
                  <button
                    type="button"
                    disabled={
                      !viewerProfileId ||
                      Boolean(imageActionBusy) ||
                      isMockImagePost(selected.post.id)
                    }
                    onClick={() => void reportImage()}
                  >
                    {locale === "ja" ? "通報" : "Report"}
                  </button>
                </div>
                {imageActionNotice ? (
                  <small className="image-viewer-app__notice" role="status">
                    {imageActionNotice}
                  </small>
                ) : null}
                <a href={`/posts/${encodeURIComponent(selected.post.id)}`}>
                  {locale === "ja" ? "元のポストを見る" : "View original post"}
                </a>
              </header>
              <section className="image-viewer-app__comments">
                <h3>
                  {locale === "ja" ? "コメント" : "Comments"}{" "}
                  <span>{comments.length}</span>
                </h3>
                {commentsLoading ? (
                  <p>{locale === "ja" ? "読み込み中…" : "Loading…"}</p>
                ) : comments.length ? (
                  comments.map((comment) => (
                    <article key={comment.id}>
                      <b>{comment.displayName}</b>
                      <p>{comment.body}</p>
                    </article>
                  ))
                ) : (
                  <p>
                    {locale === "ja"
                      ? "まだコメントはありません"
                      : "No comments yet"}
                  </p>
                )}
              </section>
              {viewerProfileId ? (
                <form
                  className="image-viewer-app__composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitComment();
                  }}
                >
                  <textarea
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder={
                      locale === "ja" ? "コメントを書く" : "Write a comment"
                    }
                    maxLength={20000}
                  />
                  <button
                    type="submit"
                    disabled={!commentDraft.trim() || commentBusy}
                  >
                    {locale === "ja" ? "送信" : "Send"}
                  </button>
                </form>
              ) : null}
              {related.length ? (
                <section className="image-viewer-app__related">
                  <h3>{locale === "ja" ? "関連画像" : "Related images"}</h3>
                  <div>
                    {related.flatMap((post) =>
                      (post.images ?? []).slice(0, 1).map((image) => (
                        <button
                          type="button"
                          key={`${post.id}:${image.id}`}
                          onClick={() => openImage(post, image)}
                        >
                          <img
                            src={image.url}
                            width={image.width}
                            height={image.height}
                            alt={image.altText || post.body}
                            loading="lazy"
                          />
                        </button>
                      )),
                    )}
                  </div>
                </section>
              ) : null}
            </aside>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function SearchResults({
  initialQuery = "",
  discovery,
  trends,
  locale = "ja",
  currentProfileId = "",
}: {
  initialQuery?: string;
  discovery: SearchDiscoveryData;
  trends?: SearchTrends;
  locale?: HubLocale;
  currentProfileId?: string;
}) {
  const copy = hubUi(locale);
  const text = (ja: string, en: string, ko: string, zh: string) =>
    localizedText(locale, { ja, en, ko, "zh-CN": zh });
  const [q, setQ] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());
  const [searchVersion, setSearchVersion] = useState(0);
  const [data, setData] = useState(EMPTY);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(Boolean(initialQuery.trim()));
  const [hasSearched, setHasSearched] = useState(Boolean(initialQuery.trim()));
  const [error, setError] = useState("");
  const [imageOrder, setImageOrder] = useState<
    "recommended" | "relevant" | "popular" | "newest"
  >(initialQuery.trim() ? "relevant" : "recommended");
  const [imageSignalVersion, setImageSignalVersion] = useState(0);
  const [imagePersonalizationReady, setImagePersonalizationReady] =
    useState(false);
  const [searchOrder, setSearchOrder] = useState<SearchOrder>("relevant");
  const [visibleLimit, setVisibleLimit] = useState(8);
  const tabsRef = useRef<HTMLElement>(null);

  useEffect(() => setImagePersonalizationReady(true), []);

  useEffect(() => {
    const activeTab = tabsRef.current?.querySelector<HTMLButtonElement>(
      'button[aria-pressed="true"]',
    );
    activeTab?.scrollIntoView?.({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }, [filter]);

  useEffect(
    () => setVisibleLimit(filter === "images" ? 12 : 8),
    [filter, query],
  );

  useEffect(() => {
    if (!query) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      fetch(
        `/api/search?${new URLSearchParams(query.trim() ? { q: query.trim() } : {})}`,
        { signal: controller.signal },
      ).then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<CorePayload>;
      }),
      fetch("/music/api/tracks", { signal: controller.signal })
        .then((response) =>
          response.ok
            ? (response.json() as Promise<{ tracks?: Payload["music"] }>)
            : null,
        )
        .catch(() => null),
    ])
      .then(([core, musicPayload]) => {
        const music = (musicPayload?.tracks ?? [])
          .filter((item) =>
            matchesExternalSearch(
              [item.title, item.artist, item.description],
              query,
            ),
          )
          .sort(
            (left, right) =>
              scoreSearchFields(query, [
                { value: right.title, weight: 12 },
                { value: right.artist, weight: 8 },
                { value: right.description, weight: 2 },
              ]) -
              scoreSearchFields(query, [
                { value: left.title, weight: 12 },
                { value: left.artist, weight: 8 },
                { value: left.description, weight: 2 },
              ]),
          )
          .slice(0, 20);
        setData({
          ...EMPTY,
          ...core,
          counts: {
            ...EMPTY.counts,
            ...core.counts,
            music: music.length,
          },
          music,
        });
      })
      .catch((fetchError) => {
        if (fetchError.name !== "AbortError") setError(copy.search.failed);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, searchVersion]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = q.trim();
    setHasSearched(Boolean(normalized));
    setQuery(normalized);
    setFilter("all");
    setSearchOrder("relevant");
    setImageOrder(normalized ? "relevant" : "recommended");
    if (!normalized) {
      setData(EMPTY);
      setFilter("all");
    }
    setSearchVersion((version) => version + 1);
  }

  const internalTotal = useMemo(
    () =>
      Object.entries(data.counts).reduce(
        (sum, [key, count]) => (key === "images" ? sum : sum + count),
        0,
      ),
    [data.counts],
  );
  const total = internalTotal;
  const show = (target: HubResultKind) =>
    target === "images"
      ? filter === "images"
      : filter === "all" || filter === target;
  const googleTabs: Array<[Filter, string]> = [
    ["all", "Hub"],
    ["profiles", text("ユーザー", "People", "사용자", "用户")],
    ["posts", text("フィード", "Feed", "피드", "动态")],
    ["threads", text("スレッド", "Threads", "스레드", "主题")],
    ["boards", text("カテゴリ", "Categories", "카테고리", "分类")],
    ["images", text("画像", "Images", "이미지", "图片")],
    ["videos", text("動画", "Videos", "동영상", "视频")],
    ["products", text("マーケット", "Market", "마켓", "市场")],
    ["tokens", text("トークン", "Tokens", "토큰", "代币")],
    ["work", text("仕事", "Work", "일자리", "工作")],
    [
      "listings",
      text("地域・旅行", "Local & travel", "지역・여행", "本地・旅行"),
    ],
    ["music", text("音楽", "Music", "음악", "音乐")],
    ["communities", text("コミュニティ", "Communities", "커뮤니티", "社区")],
    ["hubpedia", "Hubpedia"],
    ["lists", text("リスト", "Lists", "목록", "列表")],
  ];
  const activeTabLabel =
    googleTabs.find(([value]) => value === filter)?.[1] ?? "Hub";
  const activeResultCount = filter === "all" ? total : data.counts[filter];
  const visibleResultCeiling =
    filter === "all"
      ? Math.max(
          0,
          ...Object.entries(data.counts)
            .filter(([key]) => key !== "images")
            .map(([, count]) => count),
        )
      : activeResultCount;
  const orderedPosts = useMemo(
    () =>
      searchOrder === "relevant"
        ? data.posts
        : [...data.posts].sort((left, right) =>
            searchOrder === "newest"
              ? (right.createdAt ?? "").localeCompare(left.createdAt ?? "")
              : (right.score ?? 0) +
                (right.likeCount ?? 0) +
                (right.replyCount ?? 0) -
                ((left.score ?? 0) +
                  (left.likeCount ?? 0) +
                  (left.replyCount ?? 0)),
          ),
    [data.posts, searchOrder],
  );
  const orderedThreads = useMemo(
    () =>
      searchOrder === "popular"
        ? [...data.threads].sort(
            (left, right) => right.postCount - left.postCount,
          )
        : data.threads,
    [data.threads, searchOrder],
  );
  const orderedImages = useMemo(() => {
    const source = hasSearched ? data.images : (discovery.images ?? []);
    if (imageOrder === "recommended") {
      if (
        !imagePersonalizationReady ||
        typeof window === "undefined" ||
        !hubPersonalizationEnabled(window.localStorage)
      )
        return source;
      return rankHubImages(
        source.map((post) => ({ ...post, score: post.score ?? 0 })),
        {
          interests: topHubInterests(
            readHubInterestProfile(window.localStorage),
            12,
          ),
          historyIds: readHubImageHistory(window.localStorage),
          queryActive: hasSearched,
        },
      );
    }
    return imageOrder === "relevant"
      ? source
      : imageOrder === "newest"
        ? [...source].sort((left, right) =>
            (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
          )
        : [...source].sort(
            (left, right) => (right.score ?? 0) - (left.score ?? 0),
          );
  }, [
    data.images,
    discovery.images,
    hasSearched,
    imageOrder,
    imageSignalVersion,
    imagePersonalizationReady,
  ]);

  const clearSearch = () => {
    setQ("");
    setQuery("");
    setData(EMPTY);
    setFilter("all");
    setHasSearched(false);
    setImageOrder("recommended");
    setSearchOrder("relevant");
    setError("");
  };

  return (
    <div className="search-page">
      <header>
        <h1>{copy.search.title}</h1>
        <form role="search" onSubmit={submitSearch}>
          <label>
            <input
              type="search"
              placeholder={copy.search.placeholder}
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </label>
          <SearchSubmitButton
            label={copy.common.search}
            disabled={loading}
            pending={loading}
          />
        </form>
        <div aria-live="polite" aria-atomic="true">
          {loading && <small>{copy.search.searching}</small>}
          {error && (
            <small className="inline-error" role="alert">
              {error}
            </small>
          )}
        </div>
      </header>
      <nav
        ref={tabsRef}
        className="search-tabs search-tabs--google"
        aria-label={copy.search.target}
      >
        {googleTabs.map(([value, label]) => (
          <button
            type="button"
            className={filter === value ? "active" : ""}
            aria-pressed={filter === value}
            key={value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {hasSearched && !loading ? (
        <>
          <div className="search-results-summary" aria-live="polite">
            <p>
              <strong>「{query}」</strong>
              <span>
                {total}
                {copy.common.results}
              </span>
            </p>
            <div className="search-results-summary__actions">
              <label>
                {locale === "ja" ? "並び順" : "Sort"}
                <select
                  value={searchOrder}
                  onChange={(event) => {
                    const order = event.target.value as SearchOrder;
                    setSearchOrder(order);
                    if (filter === "images") setImageOrder(order);
                  }}
                >
                  <option value="relevant">
                    {locale === "ja" ? "関連度" : "Relevance"}
                  </option>
                  <option value="popular">
                    {locale === "ja" ? "人気" : "Popular"}
                  </option>
                  <option value="newest">
                    {locale === "ja" ? "新着" : "Newest"}
                  </option>
                </select>
              </label>
              <button type="button" onClick={clearSearch}>
                {locale === "ja" ? "検索をクリア" : "Clear search"}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {hasSearched && loading ? (
        <div className="search-loading" role="status">
          <span aria-hidden="true" />
          <p>{copy.search.searching}</p>
        </div>
      ) : null}

      {!hasSearched ? (
        <section
          className={`search-discovery${filter === "images" ? " search-discovery--images" : ""}`}
          aria-label={copy.search.discover}
        >
          {trends ? (
            <div className="search-discovery__block search-discovery__trends">
              <h2>{text("トレンド", "Trends", "트렌드", "趋势")}</h2>
              <CommunityTrends
                threadRanking={trends.threadRanking}
                socialRanking={trends.socialRanking}
                hubpediaRanking={trends.hubpediaRanking}
                tokenRanking={trends.tokenRanking}
                communityRanking={trends.communityRanking}
                locale={locale}
              />
            </div>
          ) : null}
          {discovery.images.length > 0 ? (
            <div className="search-discovery__block image-search-section">
              <div className="image-search-heading">
                <h2>
                  {locale === "ja" ? "画像を見つける" : "Discover images"}
                </h2>
                <div
                  className="image-feed-order"
                  role="group"
                  aria-label={locale === "ja" ? "画像の並び順" : "Image order"}
                >
                  <button
                    type="button"
                    className={
                      imageOrder === "recommended"
                        ? "image-feed-order--active"
                        : ""
                    }
                    onClick={() => setImageOrder("recommended")}
                  >
                    {locale === "ja" ? "おすすめ" : "For you"}
                  </button>
                  <button
                    type="button"
                    className={
                      imageOrder === "popular" ? "image-feed-order--active" : ""
                    }
                    onClick={() => setImageOrder("popular")}
                  >
                    {locale === "ja" ? "人気" : "Popular"}
                  </button>
                  <button
                    type="button"
                    className={
                      imageOrder === "newest" ? "image-feed-order--active" : ""
                    }
                    onClick={() => setImageOrder("newest")}
                  >
                    {locale === "ja" ? "新着" : "Newest"}
                  </button>
                </div>
              </div>
              <PinterestImageGrid
                posts={orderedImages.slice(0, 12)}
                locale={locale}
                viewerProfileId={currentProfileId}
                onSignal={() => setImageSignalVersion((value) => value + 1)}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {hasSearched && !loading && !error && filter === "all" && total === 0 ? (
        <div className="search-empty">
          <strong>{copy.search.noResults}</strong>
          <p>{copy.search.noResultsHelp}</p>
        </div>
      ) : null}
      {hasSearched &&
      !loading &&
      !error &&
      filter !== "all" &&
      activeResultCount === 0 ? (
        <div className="search-empty search-empty--category">
          <strong>
            {locale === "ja"
              ? `${activeTabLabel}に一致する結果はありません`
              : `No matching ${activeTabLabel.toLowerCase()} results`}
          </strong>
          <p>
            {locale === "ja"
              ? "検索語を短くするか、別の言葉で検索してください。"
              : "Try a shorter query or different words."}
          </p>
        </div>
      ) : null}

      {show("profiles") && data.profiles.length > 0 ? (
        <section>
          <h2>{copy.common.users}</h2>
          <div className="search-users">
            {data.profiles.slice(0, visibleLimit).map((profile) => (
              <a key={profile.id} href={`/profile/${profile.handle}`}>
                <b className="search-user-avatar" aria-hidden="true">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" loading="lazy" />
                  ) : (
                    profile.displayName.slice(0, 1)
                  )}
                </b>
                <span>
                  <strong>{profile.displayName}</strong>
                  <small>@{profile.handle}</small>
                  <p>{profile.bio}</p>
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {show("posts") && orderedPosts.length > 0 ? (
        <section>
          <h2>{copy.common.posts}</h2>
          <div className="home-feed__stream search-post-results">
            {orderedPosts.slice(0, visibleLimit).map((post) => (
              <TweetCard
                key={post.id}
                post={toTimelinePost(post)}
                locale={locale}
                viewerProfileId={currentProfileId}
              />
            ))}
          </div>
        </section>
      ) : null}
      {show("images") && data.images.length > 0 ? (
        <section className="image-search-section">
          <div className="image-search-heading">
            <h2>{locale === "ja" ? "画像" : "Images"}</h2>
            <div
              className="image-feed-order"
              role="group"
              aria-label={
                locale === "ja" ? "画像検索結果の並び順" : "Image result order"
              }
            >
              <button
                type="button"
                className={
                  imageOrder === "relevant" ? "image-feed-order--active" : ""
                }
                onClick={() => setImageOrder("relevant")}
              >
                {locale === "ja" ? "関連度" : "Relevant"}
              </button>
              <button
                type="button"
                className={
                  imageOrder === "recommended" ? "image-feed-order--active" : ""
                }
                onClick={() => setImageOrder("recommended")}
              >
                {locale === "ja" ? "おすすめ" : "For you"}
              </button>
              <button
                type="button"
                className={
                  imageOrder === "popular" ? "image-feed-order--active" : ""
                }
                onClick={() => setImageOrder("popular")}
              >
                {locale === "ja" ? "人気" : "Popular"}
              </button>
              <button
                type="button"
                className={
                  imageOrder === "newest" ? "image-feed-order--active" : ""
                }
                onClick={() => setImageOrder("newest")}
              >
                {locale === "ja" ? "新着" : "Newest"}
              </button>
            </div>
          </div>
          <PinterestImageGrid
            posts={orderedImages.slice(0, visibleLimit)}
            locale={locale}
            viewerProfileId={currentProfileId}
            onSignal={() => setImageSignalVersion((value) => value + 1)}
          />
        </section>
      ) : null}
      {show("threads") && orderedThreads.length > 0 ? (
        <section>
          <h2>{copy.common.threads}</h2>
          <div className="search-items">
            {orderedThreads.slice(0, visibleLimit).map((thread) => (
              <a key={thread.id} href={`/threads/${thread.id}`}>
                <strong>{thread.title}</strong>
                <small>
                  {thread.postCount}
                  {copy.search.replies}
                </small>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {show("boards") && data.boards.length > 0 ? (
        <section>
          <h2>{copy.common.categories}</h2>
          <div className="search-items">
            {data.boards.slice(0, visibleLimit).map((board) => (
              <a key={board.id} href={`/bbs/${board.key}`}>
                <strong>{board.title}</strong>
                <small>
                  {board.threadCount}
                  {copy.search.threadCount}
                </small>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {show("hubpedia") && data.hubpedia.length > 0 ? (
        <section>
          <h2>Hubpedia</h2>
          <div className="search-items search-hubpedia">
            {data.hubpedia.slice(0, visibleLimit).map((article) => (
              <a key={article.slug} href={hubpediaArticleHref(article.slug)}>
                <strong>
                  {article.title} <small>{article.category}</small>
                </strong>
                <p>{article.summary}</p>
                <span>{copy.search.sample}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {show("communities") && data.communities.length > 0 ? (
        <section>
          <h2>{locale === "ja" ? "コミュニティ" : "Communities"}</h2>
          <div className="search-items">
            {data.communities.slice(0, visibleLimit).map((community) => (
              <a
                key={community.id}
                href={`/community?community=${encodeURIComponent(community.slug)}`}
              >
                <strong>
                  {community.name} <small>{community.category}</small>
                </strong>
                <p>{community.description}</p>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {show("music") && data.music.length > 0 ? (
        <section>
          <h2>{locale === "ja" ? "音楽" : "Music"}</h2>
          <div className="search-items">
            {data.music.slice(0, visibleLimit).map((track) => (
              <a
                key={track.id}
                href={`/music?work=${encodeURIComponent(track.id)}`}
              >
                <strong>{track.title}</strong>
                <p>
                  {track.artist} · {track.description}
                </p>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {show("products") && data.products.length > 0 ? (
        <section>
          <h2>{locale === "ja" ? "商品" : "Products"}</h2>
          <div className="search-items search-action-results">
            {data.products.slice(0, visibleLimit).map((product) => (
              <HubActionCard
                key={product.id}
                action={createHubActionProjection({
                  type: "purchase",
                  publicResourceRef: `commerce:product:${publicResourceToken(product.id)}`,
                  ownerService: "commerce",
                  projectionVersion: "1",
                  label: product.category,
                  title: product.title,
                  description: product.seller,
                  priceLabel: `${product.price.toLocaleString(locale)} ${product.currency}`,
                  href: `/market/products/${encodeURIComponent(product.id)}`,
                  status: "available",
                })}
              />
            ))}
          </div>
        </section>
      ) : null}
      {show("tokens") && data.tokens.length > 0 ? (
        <section>
          <h2>{locale === "ja" ? "トークン" : "Tokens"}</h2>
          <div className="search-items">
            {data.tokens.slice(0, visibleLimit).map((token) => (
              <a
                key={token.id}
                href={`/token?ranking=${encodeURIComponent(token.id)}`}
              >
                <strong>
                  {token.title} <small>{token.symbol}</small>
                </strong>
                <p>
                  {token.network} · {token.description}
                </p>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {show("work") && data.work.some((item) => item.kind === "job") ? (
        <section>
          <h2>{locale === "ja" ? "求人" : "Jobs"}</h2>
          <div className="search-items search-action-results">
            {data.work
              .filter((item) => item.kind === "job")
              .slice(0, visibleLimit)
              .map((item) => (
                <HubActionCard
                  key={item.id}
                  action={workActionProjection(item, locale)}
                />
              ))}
          </div>
        </section>
      ) : null}
      {show("work") && data.work.some((item) => item.kind !== "job") ? (
        <section>
          <h2>{locale === "ja" ? "クラウドソーシング" : "Crowdsourcing"}</h2>
          <div className="search-items search-action-results">
            {data.work
              .filter((item) => item.kind !== "job")
              .slice(0, visibleLimit)
              .map((item) => (
                <HubActionCard
                  key={item.id}
                  action={workActionProjection(item, locale)}
                />
              ))}
          </div>
        </section>
      ) : null}
      {show("listings") && data.listings.length > 0 ? (
        <section>
          <h2>
            {locale === "ja"
              ? "地域・旅行・イベント"
              : "Local, travel & events"}
          </h2>
          <div className="search-items search-action-results">
            {data.listings.slice(0, visibleLimit).map((item) => (
              <HubActionCard
                key={item.id}
                action={
                  listingMarketProjection({
                    id: item.id,
                    title: item.title,
                    summary: [
                      item.category,
                      item.region,
                      item.locality,
                      item.summary,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    listingKind: item.kind,
                    providerLabel: item.providerLabel,
                    external: true,
                    href: item.providerUrl,
                    priceLabel: item.priceLabel,
                    trustStatus: item.trustStatus,
                    observedAt: item.updatedAt,
                  }).action
                }
              />
            ))}
          </div>
        </section>
      ) : null}
      {show("lists") && data.lists.length > 0 ? (
        <section>
          <h2>{locale === "ja" ? "リスト" : "Lists"}</h2>
          <div className="search-items">
            {data.lists.slice(0, visibleLimit).map((list) => (
              <a key={list.id} href="/lists?tab=community">
                <strong>{list.name}</strong>
                <p>{list.description}</p>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {hasSearched && !loading && visibleResultCeiling > visibleLimit ? (
        <div className="search-load-more">
          <button
            type="button"
            onClick={() => setVisibleLimit((limit) => Math.min(20, limit + 8))}
          >
            {locale === "ja" ? "もっと見る" : "Show more"}
          </button>
          <small>
            {Math.min(visibleLimit, visibleResultCeiling)} /{" "}
            {visibleResultCeiling}
          </small>
        </div>
      ) : null}
    </div>
  );
}
