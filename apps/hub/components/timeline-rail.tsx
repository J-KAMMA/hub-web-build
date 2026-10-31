"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { SearchSubmitButton } from "@/components/search-submit-button";
import { TweetCard, type TimelinePost } from "@/components/timeline-client";
import {
  EngagementSummary,
  FollowRelation,
  SocialPost,
  UserList,
} from "@/lib/domain";
import { rankPopularFeed, sortNewestFeed } from "@/lib/feed-ranking";
import { HUBPEDIA_ARTICLES, HubpediaArticle } from "@/lib/hubpedia-content";
import {
  normalizeHubpediaSearchText,
  scoreHubpediaSearchFields,
} from "@/lib/encyclopedia/search-text";
import { removeRepeatedTitleFromSummary } from "@/lib/encyclopedia/summary-display";
import type { HubLocale } from "@/lib/i18n";
import { hubUi } from "@/lib/ui-copy";
import type { HubpediaContextDetail } from "@/lib/hubpedia-context";
import { hubpediaArticleHref } from "@/lib/hubpedia-navigation";

interface Item extends SocialPost {
  avatarUrl?: string;
  replyCount: number;
  likeCount: number;
  score: number;
  bookmarked: boolean;
  viewerReaction: EngagementSummary["viewerReaction"];
  repostCount?: number;
  quoteRepostCount?: number;
  referenced?: {
    label: string;
    title: string;
    body: string;
    href: string;
    contextLabel?: string;
    avatarUrl?: string;
    avatarLabel?: string;
  } | null;
}

interface Props {
  socialPosts: Item[];
  currentProfileId: string;
  follows: FollowRelation[];
  lists: UserList[];
  hubpediaArticles?: HubpediaArticle[];
  locale?: HubLocale;
  isOpen?: boolean;
  onToggle?: () => void;
  requestedMode?: "timeline" | "posts" | "hubpedia";
  standaloneMode?: boolean;
  deprioritizePostIds?: string[];
  contextText?: string;
  contextSource?: Pick<HubpediaContextDetail, "targetId" | "targetType"> | null;
}

type Mode = "timeline" | "posts" | "hubpedia";
type HubpediaFeed = "recommended" | "popular" | "latest";
type RailSearchKind =
  | "all"
  | "posts"
  | "threads"
  | "images"
  | "videos"
  | "products"
  | "communities"
  | "hubpedia";
type RailSearchItem = {
  id: string;
  kind: Exclude<RailSearchKind, "all">;
  title: string;
  description: string;
  href: string;
  imageUrl?: string;
};
type RailSearchStatus = "idle" | "loading" | "success" | "error";

const RAIL_SEARCH_CACHE_TTL_MS = 30_000;
const railSearchCache = new Map<
  string,
  { expiresAt: number; items: RailSearchItem[] }
>();

const RAIL_SEARCH_TABS: Array<[RailSearchKind, string]> = [
  ["all", "Hub"],
  ["posts", "投稿"],
  ["threads", "スレッド"],
  ["images", "画像"],
  ["videos", "動画"],
  ["products", "マーケット"],
  ["communities", "コミュニティ"],
  ["hubpedia", "Hubpedia"],
];

function Icon({ type }: { type: Mode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {type === "timeline" ? (
        <>
          <path d="M5 5v14M9 7h10M9 12h7M9 17h10" />
        </>
      ) : type === "posts" ? (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </>
      ) : (
        <>
          <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23V5.5Z" />
          <path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23V5.5Z" />
        </>
      )}
    </svg>
  );
}

export function TimelineRail({
  socialPosts,
  currentProfileId,
  follows,
  lists,
  hubpediaArticles = HUBPEDIA_ARTICLES,
  locale = "ja",
  isOpen = true,
  onToggle = () => {},
  requestedMode = "timeline",
  standaloneMode = false,
  deprioritizePostIds = [],
  contextText = "",
  contextSource = null,
}: Props) {
  const ui = hubUi(locale);
  const copy = ui.rail;
  const [mode, setMode] = useState<Mode>(requestedMode);
  const [query, setQuery] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchKind, setSearchKind] = useState<RailSearchKind>("all");
  const [searchItems, setSearchItems] = useState<RailSearchItem[]>([]);
  const [searchStatus, setSearchStatus] = useState<RailSearchStatus>("idle");
  const [searchRetryNonce, setSearchRetryNonce] = useState(0);
  const [feedFilter, setFeedFilter] = useState("popular");
  const [hubpediaFeed, setHubpediaFeed] = useState<HubpediaFeed>("recommended");
  const [candidateStatus, setCandidateStatus] = useState("");
  const term = normalizeHubpediaSearchText(query);
  const normalizedContext = normalizeHubpediaSearchText(contextText);
  const suggestArticle = async () => {
    if (!contextSource) return;
    setCandidateStatus("送信中…");
    const response = await fetch("/api/hubpedia/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType: contextSource.targetType,
        sourceId: contextSource.targetId,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      duplicate?: boolean;
    };
    setCandidateStatus(
      response.ok
        ? payload.duplicate
          ? "提案済みです"
          : "記事候補として提案しました"
        : (payload.error ?? "提案できませんでした"),
    );
  };

  useEffect(() => {
    setMode(requestedMode);
    setQuery("");
    setSearchDraft("");
  }, [requestedMode]);

  useEffect(() => {
    const savedFilter = localStorage.getItem("hub.rail-feed-filter");
    if (
      savedFilter &&
      (savedFilter === "all" ||
        savedFilter === "popular" ||
        savedFilter === "following" ||
        lists.some((list) => list.id === savedFilter))
    ) {
      setFeedFilter(savedFilter === "all" ? "popular" : savedFilter);
    }
  }, [lists]);

  useEffect(() => {
    if ((mode !== "posts" && mode !== "hubpedia") || !query) {
      setSearchItems([]);
      setSearchStatus("idle");
      return;
    }
    const cacheKey = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
    const cached = railSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setSearchItems(cached.items);
      setSearchStatus("success");
      return;
    }
    const controller = new AbortController();
    setSearchStatus("loading");
    void fetch(`/api/search?${new URLSearchParams({ q: query })}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("search_failed");
        return response.json() as Promise<
          Record<string, Array<Record<string, unknown>>>
        >;
      })
      .then((data) => {
        const text = (value: unknown) =>
          typeof value === "string" ? value : "";
        const items: RailSearchItem[] = [
          ...(data.posts ?? []).map((item) => ({
            id: text(item.id),
            kind: "posts" as const,
            title: text(item.displayName) || "投稿",
            description: text(item.body),
            href: `/posts/${encodeURIComponent(text(item.id))}`,
          })),
          ...(data.threads ?? []).map((item) => ({
            id: text(item.id),
            kind: "threads" as const,
            title: text(item.title),
            description: `${Number(item.postCount ?? 0)}件の投稿`,
            href: `/threads/${encodeURIComponent(text(item.id))}`,
          })),
          ...(data.images ?? []).map((item) => {
            const images = Array.isArray(item.images)
              ? (item.images as Array<Record<string, unknown>>)
              : [];
            return {
              id: text(item.id),
              kind: "images" as const,
              title: text(item.displayName) || "画像",
              description: text(item.body),
              href: `/posts/${encodeURIComponent(text(item.id))}`,
              imageUrl: text(images[0]?.url),
            };
          }),
          ...(data.communities ?? []).map((item) => ({
            id: text(item.id),
            kind: "communities" as const,
            title: text(item.name),
            description: text(item.description),
            href: `/community?community=${encodeURIComponent(text(item.slug))}`,
          })),
          ...(data.hubpedia ?? []).map((item) => ({
            id: text(item.slug),
            kind: "hubpedia" as const,
            title: text(item.title),
            description: removeRepeatedTitleFromSummary(
              text(item.title),
              text(item.summary),
            ),
            href: hubpediaArticleHref(text(item.slug)),
          })),
        ];
        const validItems = items.filter((item) => item.id && item.title);
        railSearchCache.set(cacheKey, {
          expiresAt: Date.now() + RAIL_SEARCH_CACHE_TTL_MS,
          items: validItems,
        });
        setSearchItems(validItems);
        setSearchStatus("success");
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== "AbortError") {
          if (mode === "hubpedia") {
            // Hubpedia keeps its bundled catalog available when unified search
            // is offline; post search has no equivalent authoritative fallback.
            setSearchItems([]);
            setSearchStatus("success");
          } else {
            setSearchItems([]);
            setSearchStatus("error");
          }
        }
      });
    return () => controller.abort();
  }, [mode, query, searchRetryNonce]);

  const followedProfileIds = useMemo(
    () =>
      new Set(
        follows
          .filter((relation) => relation.followerProfileId === currentProfileId)
          .map((relation) => relation.followedProfileId),
      ),
    [currentProfileId, follows],
  );

  const posts = useMemo(() => {
    const filtered = socialPosts.filter((post) => {
      if (mode === "timeline" && feedFilter === "following") {
        return (
          post.authorProfileId === currentProfileId ||
          Boolean(
            post.authorProfileId &&
            followedProfileIds.has(post.authorProfileId),
          )
        );
      }
      if (mode === "posts" && term) {
        return `${post.displayName} ${post.handle ?? ""} ${post.body}`
          .toLocaleLowerCase("ja")
          .includes(term);
      }
      return true;
    });
    const ordered =
      mode === "timeline" && feedFilter === "popular"
        ? rankPopularFeed(filtered)
        : sortNewestFeed(filtered);
    if (mode !== "timeline" || deprioritizePostIds.length === 0)
      return ordered.slice(0, 30);
    const centralIds = new Set(deprioritizePostIds);
    return ordered.filter((post) => !centralIds.has(post.id)).slice(0, 30);
  }, [
    deprioritizePostIds,
    feedFilter,
    followedProfileIds,
    mode,
    socialPosts,
    term,
  ]);

  const localArticles = useMemo(
    () =>
      term
        ? hubpediaArticles
            .map((item) => ({
              item,
              score: scoreHubpediaSearchFields(item, term),
            }))
            .filter(({ score }) => score > 0)
            .sort(
              (left, right) =>
                right.score - left.score ||
                left.item.title.localeCompare(right.item.title, "ja"),
            )
            .map(({ item }) => item)
        : hubpediaArticles,
    [hubpediaArticles, term],
  );
  const contextualArticles = useMemo(() => {
    if (!normalizedContext) return hubpediaArticles;
    return hubpediaArticles
      .map((item) => {
        const title = normalizeHubpediaSearchText(item.title);
        const aliases = (item.aliases ?? []).map(normalizeHubpediaSearchText);
        const category = normalizeHubpediaSearchText(item.category);
        const summaryTerms = normalizeHubpediaSearchText(item.summary)
          .split(/[\s、。・,()（）「」『』]+/)
          .filter((value) => value.length >= 2);
        const score =
          (title && normalizedContext.includes(title) ? 1000 : 0) +
          aliases.reduce(
            (total, alias) =>
              total +
              (alias.length >= 2 && normalizedContext.includes(alias)
                ? 700
                : 0),
            0,
          ) +
          (category && normalizedContext.includes(category) ? 120 : 0) +
          summaryTerms
            .slice(0, 24)
            .reduce(
              (total, value) =>
                total +
                (normalizedContext.includes(value)
                  ? Math.min(40, value.length * 4)
                  : 0),
              0,
            );
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.item.title.localeCompare(right.item.title, "ja"),
      )
      .map(({ item }) => item);
  }, [hubpediaArticles, normalizedContext]);
  const searchedArticles = useMemo(
    () => searchItems.filter((item) => item.kind === "hubpedia"),
    [searchItems],
  );
  const hubpediaSearchResults =
    searchedArticles.length > 0
      ? searchedArticles
      : localArticles.map((item): RailSearchItem => ({
          id: item.slug,
          kind: "hubpedia",
          title: item.title,
          description: removeRepeatedTitleFromSummary(item.title, item.summary),
          href: hubpediaArticleHref(item.slug),
        }));
  const rankedArticles = useMemo(() => {
    if (term) return localArticles;
    if (hubpediaFeed === "recommended") {
      return normalizedContext && contextualArticles.length > 0
        ? contextualArticles
        : localArticles;
    }
    const rankKey = hubpediaFeed === "popular" ? "popularRank" : "latestRank";
    return [...localArticles].sort(
      (left, right) =>
        (left[rankKey] ?? Number.MAX_SAFE_INTEGER) -
          (right[rankKey] ?? Number.MAX_SAFE_INTEGER) ||
        left.title.localeCompare(right.title, "ja"),
    );
  }, [
    contextualArticles,
    hubpediaFeed,
    localArticles,
    normalizedContext,
    term,
  ]);
  const articles =
    mode === "hubpedia" && query ? hubpediaSearchResults : rankedArticles;
  const visibleSearchItems = useMemo(
    () =>
      searchItems.filter(
        (item) => searchKind === "all" || item.kind === searchKind,
      ),
    [searchItems, searchKind],
  );
  const resultCount =
    mode === "hubpedia"
      ? articles.length
      : mode === "posts" && query
        ? visibleSearchItems.length
        : posts.length;
  const title =
    mode === "timeline"
      ? copy.feed
      : mode === "posts"
        ? copy.search
        : "Hubpedia";

  const switchMode = (next: Mode) => {
    setMode(next);
    setQuery("");
  };

  const selectFeed = (next: string) => {
    setFeedFilter(next);
    localStorage.setItem("hub.rail-feed-filter", next);
  };

  return (
    <aside
      className={
        isOpen ? "timeline-rail" : "timeline-rail timeline-rail--collapsed"
      }
      aria-label={copy.panel}
    >
      <div className="timeline-rail__header">
        <div className="timeline-rail__title-row">
          {isOpen && (
            <div>
              <h2>{title}</h2>
            </div>
          )}
          <button
            type="button"
            className="timeline-rail__toggle"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? copy.collapse : copy.expand}
            title={isOpen ? copy.collapse : copy.expand}
          >
            {isOpen ? (
              <ChevronRight aria-hidden="true" />
            ) : (
              <ChevronLeft aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {isOpen && (
        <>
          <div className="rail-controls">
            {!standaloneMode && (
              <nav className="rail-mode" aria-label={copy.content}>
                {(["timeline", "posts", "hubpedia"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={mode === item ? "rail-mode__active" : ""}
                    aria-pressed={mode === item}
                    onClick={() => switchMode(item)}
                  >
                    <Icon type={item} />
                    <span>
                      {item === "timeline"
                        ? copy.feed
                        : item === "posts"
                          ? copy.search
                          : "Hubpedia"}
                    </span>
                  </button>
                ))}
              </nav>
            )}

            {mode === "timeline" && (
              <div className="rail-list-filter" aria-label={ui.feed.feedLabel}>
                <div className="rail-list-filter__primary">
                  <button
                    type="button"
                    className={
                      feedFilter === "popular" ? "rail-list-filter__active" : ""
                    }
                    aria-pressed={feedFilter === "popular"}
                    onClick={() => selectFeed("popular")}
                  >
                    {copy.popular}
                  </button>
                  <button
                    type="button"
                    className={
                      feedFilter === "following"
                        ? "rail-list-filter__active"
                        : ""
                    }
                    aria-pressed={feedFilter === "following"}
                    onClick={() => selectFeed("following")}
                  >
                    {copy.following}
                  </button>
                </div>
              </div>
            )}

            {mode !== "timeline" && (
              <form
                className="rail-search"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  setQuery(
                    String(
                      new FormData(event.currentTarget).get("q") ?? "",
                    ).trim(),
                  );
                }}
              >
                <input
                  type="search"
                  name="q"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder={
                    mode === "posts"
                      ? copy.postPlaceholder
                      : copy.articlePlaceholder
                  }
                  aria-label={
                    mode === "posts" ? copy.postAria : copy.articleAria
                  }
                />
                <SearchSubmitButton label={ui.common.search} />
              </form>
            )}
            {mode === "hubpedia" && !query && (
              <nav
                className="rail-hubpedia-filter"
                aria-label="Hubpediaの記事の並び順"
              >
                {(
                  [
                    ["recommended", "おすすめ"],
                    ["popular", "人気"],
                    ["latest", "新着"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={hubpediaFeed === value ? "is-active" : ""}
                    aria-pressed={hubpediaFeed === value}
                    onClick={() => setHubpediaFeed(value)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            )}
            {mode === "posts" && (
              <nav className="rail-search-tabs" aria-label="検索カテゴリ">
                {RAIL_SEARCH_TABS.map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={searchKind === value ? "is-active" : ""}
                    aria-pressed={searchKind === value}
                    onClick={() => setSearchKind(value)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            )}
          </div>

          <div
            className={`timeline-rail__list${mode !== "hubpedia" ? " home-feed__stream" : ""}`}
            aria-busy={searchStatus === "loading"}
          >
            {searchStatus !== "idle" || query ? (
              <span
                className="hub-sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {searchStatus === "loading"
                  ? locale === "en"
                    ? "Searching"
                    : "検索中"
                  : searchStatus === "error"
                    ? locale === "en"
                      ? "Search failed"
                      : "検索できませんでした"
                    : locale === "en"
                      ? "Search results updated"
                      : "検索結果を更新しました"}
              </span>
            ) : null}
            {mode === "hubpedia" && !query && normalizedContext ? (
              <div className="rail-context-label">
                <span>この文章に関連する記事</span>
                {contextSource &&
                contextSource.targetType !== "community_message" ? (
                  <button
                    type="button"
                    onClick={() => void suggestArticle()}
                    disabled={candidateStatus === "送信中…"}
                  >
                    記事候補にする
                  </button>
                ) : null}
                {candidateStatus ? (
                  <small role="status">{candidateStatus}</small>
                ) : null}
              </div>
            ) : null}
            {searchStatus === "error" && query ? (
              <div className="rail-empty" role="alert">
                <strong>
                  {locale === "en"
                    ? "Search is temporarily unavailable"
                    : "検索できませんでした"}
                </strong>
                <button
                  type="button"
                  onClick={() => setSearchRetryNonce((value) => value + 1)}
                >
                  {locale === "en" ? "Retry" : "再試行"}
                </button>
              </div>
            ) : mode === "hubpedia" && query ? (
              searchStatus === "loading" ? (
                <div className="rail-empty">
                  <strong>検索中…</strong>
                </div>
              ) : (
                hubpediaSearchResults.map((item) => (
                  <a
                    className="rail-result rail-result--article"
                    href={item.href}
                    key={`hubpedia:${item.id}`}
                  >
                    <span>Hubpedia</span>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </a>
                ))
              )
            ) : mode === "posts" && query ? (
              searchStatus === "loading" ? (
                <div className="rail-empty">
                  <strong>検索中…</strong>
                </div>
              ) : (
                visibleSearchItems.map((item) => (
                  <a
                    className={`rail-result rail-search-result rail-search-result--${item.kind}`}
                    href={item.href}
                    key={`${item.kind}:${item.id}`}
                  >
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                    <span>
                      {
                        RAIL_SEARCH_TABS.find(
                          ([value]) => value === item.kind,
                        )?.[1]
                      }
                    </span>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </a>
                ))
              )
            ) : mode !== "hubpedia" ? (
              posts.map((post) => (
                <React.Fragment key={post.id}>
                  <TweetCard
                    locale={locale}
                    viewerProfileId={currentProfileId}
                    post={
                      {
                        ...post,
                        repostCount: post.repostCount ?? 0,
                        quoteRepostCount: post.quoteRepostCount ?? 0,
                        referenced: post.referenced ?? null,
                      } satisfies TimelinePost
                    }
                  />
                </React.Fragment>
              ))
            ) : (
              (articles as HubpediaArticle[]).map((item) => (
                <a
                  key={item.slug}
                  href={hubpediaArticleHref(item.slug)}
                  className="rail-result rail-result--article"
                >
                  <span>{item.category}</span>
                  <h3>{item.title}</h3>
                  <p>
                    {removeRepeatedTitleFromSummary(item.title, item.summary)}
                  </p>
                </a>
              ))
            )}
            {resultCount === 0 &&
              searchStatus !== "loading" &&
              searchStatus !== "error" && (
                <div className="rail-empty">
                  <strong>{copy.empty}</strong>
                  <p>
                    {mode === "timeline" ? copy.chooseFeed : copy.retrySearch}
                  </p>
                  {mode === "timeline" && (
                    <a href="/community">{copy.findMembers}</a>
                  )}
                </div>
              )}
            {mode === "hubpedia" && (
              <a href="/hubpedia" className="rail-hub-link">
                {copy.publication}
              </a>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
