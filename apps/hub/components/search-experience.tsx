"use client";

import React, {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Trash2 } from "lucide-react";

import { CommunityTrends } from "@/components/community-trends";
import { SearchSubmitButton } from "@/components/search-submit-button";
import { SavedQueryTabs } from "@/components/saved-query-tabs";
import { TweetCard, type TimelinePost } from "@/components/timeline-client";
import { UiButton, UiInput, UiSelect, UiStatePanel } from "@/components/ui/primitives";
import { hubpediaArticleHref } from "@/lib/hubpedia-navigation";
import type { HubLocale } from "@/lib/i18n";
import {
  normalizeSearchValue,
  scoreSearchFields,
  searchAlternatives,
  searchMatchReason,
  inferSearchIntent,
} from "@/lib/search-relevance";
import type { SearchDiscoveryData } from "@/lib/server/search-page-data";
import type { RankingPageData } from "@/lib/server/ranking-page-data";

type SearchTrends = Pick<
  RankingPageData,
  | "threadRanking"
  | "socialRanking"
  | "hubpediaRanking"
  | "tokenRanking"
  | "communityRanking"
>;
type SearchPost = Partial<TimelinePost> & {
  id: string;
  displayName: string;
  handle?: string | null;
  body: string;
  createdAt?: string;
};
type ResultKind =
  | "profiles"
  | "posts"
  | "threads"
  | "boards"
  | "images"
  | "videos"
  | "music"
  | "hubpedia"
  | "communities"
  | "products"
  | "tokens"
  | "work"
  | "lists";
type SearchGroup =
  "all" | "social" | "media" | "knowledge" | "market" | "services";
type SortOrder = "relevant" | "newest" | "popular";
type DiscoveryTab = "recommended" | "trends" | "news" | "images";
type PeriodFilter = "any" | "day" | "week" | "month" | "year";
type LanguageFilter = "any" | "ja" | "en" | "ko" | "zh" | "other";

type Payload = {
  counts: Partial<Record<ResultKind, number>>;
  profiles: Array<{
    id: string;
    handle: string;
    displayName: string;
    bio: string;
  }>;
  posts: SearchPost[];
  threads: Array<{ id: string; title: string; postCount: number }>;
  boards: Array<{
    id: string;
    key: string;
    title: string;
    threadCount: number;
  }>;
  images: SearchPost[];
  videos: Array<{
    id: string;
    title: string;
    channel: string;
    category: string;
    topic: string;
    provider: string;
  }>;
  music: Array<{
    id: string;
    title: string;
    artist: string;
    description: string;
  }>;
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
  products: Array<{
    id: string;
    title: string;
    description: string;
    category: string;
    seller: string;
    price: number;
    currency: string;
  }>;
  tokens: Array<{
    id: string;
    title: string;
    symbol: string;
    network: string;
    description: string;
  }>;
  work: Array<{
    id: string;
    title: string;
    organization: string;
    summary: string;
    location: string;
    compensation: string;
  }>;
  lists: Array<{ id: string; name: string; description: string }>;
};

type SearchHit = {
  id: string;
  kind: ResultKind;
  title: string;
  description: string;
  meta: string;
  href: string;
  score: number;
  popularity: number;
  createdAt: string;
  reason: string;
  language: Exclude<LanguageFilter, "any">;
  price: number | null;
  region: string;
  category: string;
};

const EMPTY: Payload = {
  counts: {},
  profiles: [],
  posts: [],
  threads: [],
  boards: [],
  images: [],
  videos: [],
  music: [],
  hubpedia: [],
  communities: [],
  products: [],
  tokens: [],
  work: [],
  lists: [],
};
const SEARCH_REQUEST_TIMEOUT_MS = 10_000;
const OPTIONAL_SEARCH_SOURCE_TIMEOUT_MS = 5_000;
const ORIGINAL_MUSIC_TRACK_PREFIX = "music:";
const HISTORY_KEY = "hub.search.history";
const PROACTIVE_SEARCH_KEY = "hub.search.proactive.enabled";
const GROUPS: Record<SearchGroup, ResultKind[]> = {
  all: [
    "profiles",
    "posts",
    "threads",
    "boards",
    "images",
    "videos",
    "music",
    "hubpedia",
    "communities",
    "products",
    "tokens",
    "work",
    "lists",
  ],
  social: ["posts", "profiles", "communities", "lists"],
  media: ["images", "videos", "music"],
  knowledge: ["hubpedia", "threads", "boards"],
  market: ["products"],
  services: ["work", "tokens"],
};
const GROUP_LABELS: Record<SearchGroup, { ja: string; en: string }> = {
  all: { ja: "すべて", en: "All" },
  social: { ja: "投稿・ユーザー", en: "Social" },
  media: { ja: "画像・動画・作品", en: "Media & works" },
  knowledge: { ja: "知識・スレッド", en: "Knowledge" },
  market: { ja: "商品・不動産", en: "Market" },
  services: { ja: "クラウドソーシング", en: "Crowdsourcing" },
};
const KIND_LABELS: Record<ResultKind, { ja: string; en: string }> = {
  profiles: { ja: "ユーザー", en: "People" },
  posts: { ja: "投稿", en: "Posts" },
  threads: { ja: "スレッド", en: "Threads" },
  boards: { ja: "カテゴリ", en: "Categories" },
  images: { ja: "画像", en: "Images" },
  videos: { ja: "動画", en: "Videos" },
  music: { ja: "音楽", en: "Music" },
  hubpedia: { ja: "Hubpedia", en: "Hubpedia" },
  communities: { ja: "コミュニティ", en: "Communities" },
  products: { ja: "商品", en: "Products" },
  tokens: { ja: "トークン", en: "Tokens" },
  work: { ja: "仕事", en: "Work" },
  lists: { ja: "リスト", en: "Lists" },
};

class SearchRequestTimeoutError extends Error {
  constructor() {
    super("search_request_timeout");
    this.name = "TimeoutError";
  }
}

async function withSearchRequestTimeout<T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (parentSignal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onParentAbort: (() => void) | undefined;
  const parentAbort = new Promise<never>((_, reject) => {
    onParentAbort = () => {
      controller.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  });
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new SearchRequestTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      operation(controller.signal),
      parentAbort,
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (onParentAbort) {
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  }
}

function normalizeWorkerMusicSearchTracks(value: unknown): Payload["music"] {
  if (
    !value
    || typeof value !== "object"
    || !Array.isArray((value as { tracks?: unknown }).tracks)
  ) {
    throw new Error("invalid_music_catalog");
  }
  return (value as { tracks: unknown[] }).tracks.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("invalid_music_catalog");
    }
    const track = item as Partial<Payload["music"][number]>;
    if (
      typeof track.id !== "string"
      || !track.id
      || typeof track.title !== "string"
      || typeof track.artist !== "string"
      || typeof track.description !== "string"
    ) {
      throw new Error("invalid_music_catalog");
    }
    return {
      id: track.id.startsWith(ORIGINAL_MUSIC_TRACK_PREFIX)
        ? track.id
        : `${ORIGINAL_MUSIC_TRACK_PREFIX}${track.id}`,
      title: track.title,
      artist: track.artist,
      description: track.description,
    };
  });
}

function moveTabFocus<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void,
) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(current));
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? values.length - 1
        : event.key === "ArrowRight"
          ? (currentIndex + 1) % values.length
          : (currentIndex - 1 + values.length) % values.length;
  const next = values[nextIndex];
  if (!next) return;
  select(next);
  event.currentTarget.parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    .item(nextIndex)
    .focus();
}

function readHistory() {
  try {
    const value = JSON.parse(
      localStorage.getItem(HISTORY_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

function asTimelinePost(post: SearchPost): TimelinePost {
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

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = normalizeSearchValue(query);
  if (!needle) return <>{text}</>;
  const normalized = normalizeSearchValue(text);
  const start = normalized.indexOf(needle);
  if (start < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + needle.length)}</mark>
      {text.slice(start + needle.length)}
    </>
  );
}

function fieldScore(
  query: string,
  title: string,
  description: string,
  meta: string,
) {
  return scoreSearchFields(query, [
    { value: title, weight: 12 },
    { value: meta, weight: 6 },
    { value: description, weight: 2 },
  ]);
}

function detectResultLanguage(value: string): Exclude<LanguageFilter, "any"> {
  if (/[\u3040-\u30ff]/u.test(value)) return "ja";
  if (/[\uac00-\ud7af]/u.test(value)) return "ko";
  if (/[\u3400-\u9fff]/u.test(value)) return "zh";
  if (/[a-z]/iu.test(value)) return "en";
  return "other";
}

function numericPrice(value: string) {
  const parsed = Number(value.replace(/[^\d.]/gu, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toHits(data: Payload, query: string): SearchHit[] {
  const hit = (
    kind: ResultKind,
    id: string,
    title: string,
    description: string,
    meta: string,
    href: string,
    popularity = 0,
    createdAt = "",
    facets: Partial<Pick<SearchHit, "price" | "region" | "category">> = {},
  ): SearchHit => ({
    kind,
    id,
    title,
    description,
    meta,
    href,
    popularity,
    createdAt,
    score: fieldScore(query, title, description, meta),
    language: detectResultLanguage(`${title} ${description}`),
    price: facets.price ?? null,
    region: facets.region ?? "",
    category: facets.category ?? kind,
    reason: searchMatchReason(query, [
      { label: "タイトル一致", value: title, weight: 12 },
      { label: "名前・カテゴリ一致", value: meta, weight: 6 },
      { label: "本文一致", value: description, weight: 2 },
    ]),
  });
  return [
    ...data.profiles.map((x) =>
      hit(
        "profiles",
        x.id,
        x.displayName,
        x.bio,
        `@${x.handle}`,
        `/profile/${x.handle}`,
      ),
    ),
    ...data.posts.map((x) =>
      hit(
        "posts",
        x.id,
        x.displayName,
        x.body,
        x.handle ? `@${x.handle}` : "投稿",
        `/posts/${x.id}`,
        (x.score ?? 0) + (x.likeCount ?? 0) + (x.replyCount ?? 0),
        x.createdAt,
      ),
    ),
    ...data.images.map((x) =>
      hit(
        "images",
        x.id,
        x.displayName,
        x.body,
        x.handle ? `@${x.handle}` : "画像付き投稿",
        `/posts/${x.id}`,
        (x.score ?? 0) + (x.likeCount ?? 0),
        x.createdAt,
      ),
    ),
    ...data.threads.map((x) =>
      hit(
        "threads",
        x.id,
        x.title,
        "",
        `${x.postCount}件の返信`,
        `/threads/${x.id}`,
        x.postCount,
      ),
    ),
    ...data.boards.map((x) =>
      hit(
        "boards",
        x.id,
        x.title,
        "",
        `${x.threadCount}スレッド`,
        `/bbs/${x.key}`,
        x.threadCount,
      ),
    ),
    ...data.music.map((x) =>
      hit(
        "music",
        x.id,
        x.title,
        x.description,
        x.artist,
        `/music?work=${encodeURIComponent(x.id)}`,
        0,
        "",
        { category: "music" },
      ),
    ),
    ...data.hubpedia.map((x) =>
      hit(
        "hubpedia",
        x.slug,
        x.title,
        x.summary,
        x.category,
        hubpediaArticleHref(x.slug),
        0,
        "",
        { category: x.category },
      ),
    ),
    ...data.communities.map((x) =>
      hit(
        "communities",
        x.id,
        x.name,
        x.description,
        x.category,
        `/community?community=${encodeURIComponent(x.slug)}`,
        0,
        "",
        { category: x.category },
      ),
    ),
    ...data.products.map((x) =>
      hit(
        "products",
        x.id,
        x.title,
        x.description,
        `${x.seller} · ${x.price.toLocaleString()} ${x.currency}`,
        `/market/products/${encodeURIComponent(x.id)}`,
        0,
        "",
        { price: x.price, category: x.category },
      ),
    ),
    ...data.tokens.map((x) =>
      hit(
        "tokens",
        x.id,
        x.title,
        x.description,
        `${x.symbol} · ${x.network}`,
        `/token?ranking=${encodeURIComponent(x.id)}`,
      ),
    ),
    ...data.work.map((x) =>
      hit(
        "work",
        x.id,
        x.title,
        x.summary,
        `${x.organization} · ${x.location} · ${x.compensation}`,
        `/work?q=${encodeURIComponent(x.title)}`,
        0,
        "",
        {
          region: x.location,
          price: numericPrice(x.compensation),
          category: "work",
        },
      ),
    ),
    ...data.lists.map((x) =>
      hit(
        "lists",
        x.id,
        x.name,
        x.description,
        "リスト",
        "/lists?tab=community",
      ),
    ),
  ];
}

function uniqueSearchHits(items: SearchHit[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const canonicalHref =
      item.href.trim().replace(/\/+(?=[?#]|$)/, "") || "/";
    const key =
      canonicalHref !== "/"
        ? canonicalHref.toLocaleLowerCase()
        : `${item.kind}:${normalizeSearchValue(item.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentUrlState(initialQuery: string) {
  if (typeof window === "undefined")
    return {
      query: initialQuery.trim(),
      group: "all" as SearchGroup,
      kind: "all",
      sort: "relevant" as SortOrder,
      period: "any" as PeriodFilter,
      language: "any" as LanguageFilter,
      maximumPrice: "",
      region: "",
      category: "",
    };
  const params = new URLSearchParams(window.location.search);
  const group = params.get("group") as SearchGroup;
  const sort = params.get("sort") as SortOrder;
  return {
    query: (params.get("q") ?? initialQuery).trim(),
    group: group in GROUPS ? group : ("all" as SearchGroup),
    kind: params.get("type") ?? "all",
    sort: ["relevant", "newest", "popular"].includes(sort)
      ? sort
      : ("relevant" as SortOrder),
    period: (["any", "day", "week", "month", "year"].includes(
      params.get("period") ?? "",
    )
      ? params.get("period")
      : "any") as PeriodFilter,
    language: (["any", "ja", "en", "ko", "zh", "other"].includes(
      params.get("language") ?? "",
    )
      ? params.get("language")
      : "any") as LanguageFilter,
    maximumPrice: params.get("maxPrice") ?? "",
    region: params.get("region") ?? "",
    category: params.get("category") ?? "",
  };
}

export function SearchExperience({
  initialQuery = "",
  initialDiscoveryTab = "recommended",
  discovery,
  trends,
  locale = "ja",
  currentProfileId = "",
  showHeading = true,
  showSearchForm = true,
}: {
  initialQuery?: string;
  initialDiscoveryTab?: DiscoveryTab;
  discovery: SearchDiscoveryData;
  trends?: SearchTrends;
  locale?: HubLocale;
  currentProfileId?: string;
  showHeading?: boolean;
  showSearchForm?: boolean;
}) {
  const initial = useMemo(() => currentUrlState(initialQuery), [initialQuery]);
  const [query, setQuery] = useState(initial.query);
  const [draft, setDraft] = useState(initial.query);
  const [group, setGroup] = useState<SearchGroup>(initial.group);
  const [kind, setKind] = useState<ResultKind | "all">(
    GROUPS[initial.group].includes(initial.kind as ResultKind)
      ? (initial.kind as ResultKind)
      : "all",
  );
  const [sort, setSort] = useState<SortOrder>(initial.sort);
  const [period, setPeriod] = useState<PeriodFilter>(initial.period);
  const [language, setLanguage] = useState<LanguageFilter>(initial.language);
  const [maximumPrice, setMaximumPrice] = useState(initial.maximumPrice);
  const [region, setRegion] = useState(initial.region);
  const [category, setCategory] = useState(initial.category);
  const [data, setData] = useState<Payload>(EMPTY);
  const [loading, setLoading] = useState(Boolean(initial.query));
  const [error, setError] = useState("");
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [proactiveEnabled, setProactiveEnabled] = useState(true);
  const [proactiveReady, setProactiveReady] = useState(false);
  const [proactiveReasonOpen, setProactiveReasonOpen] = useState(false);
  const [discoveryTab, setDiscoveryTab] =
    useState<DiscoveryTab>(initialDiscoveryTab);
  /* The page-left column's phone drawer (the shared bbs-* column contract). */
  const [searchDirectoryOpen, setSearchDirectoryOpen] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [safeSearch, setSafeSearch] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    setHistory(readHistory());
    setProactiveEnabled(
      localStorage.getItem(PROACTIVE_SEARCH_KEY) !== "false",
    );
    setProactiveReady(true);
  }, []);
  useEffect(() => {
    if (!suggestionsOpen || suggestionIndex < 0) return;
    document
      .getElementById(`hub-search-suggestion-${suggestionIndex}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [suggestionIndex, suggestionsOpen]);
  useEffect(() => {
    const onPopState = () => {
      const state = currentUrlState("");
      setQuery(state.query);
      setDraft(state.query);
      setGroup(state.group);
      setKind(
        GROUPS[state.group].includes(state.kind as ResultKind)
          ? (state.kind as ResultKind)
          : "all",
      );
      setSort(state.sort);
      setPeriod(state.period);
      setLanguage(state.language);
      setMaximumPrice(state.maximumPrice);
      setRegion(state.region);
      setCategory(state.category);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (group !== "all") params.set("group", group);
    if (kind !== "all") params.set("type", kind);
    if (sort !== "relevant") params.set("sort", sort);
    if (period !== "any") params.set("period", period);
    if (language !== "any") params.set("language", language);
    if (maximumPrice) params.set("maxPrice", maximumPrice);
    if (region) params.set("region", region);
    if (category) params.set("category", category);
    const next = `/search${params.size ? `?${params}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== next)
      window.history.replaceState(null, "", next);
  }, [
    category,
    group,
    kind,
    language,
    maximumPrice,
    period,
    query,
    region,
    sort,
  ]);
  useEffect(() => {
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    if (!query) {
      setData(EMPTY);
      setLoading(false);
      setSourceWarnings([]);
      return;
    }
    const controller = new AbortController();
    const isCurrentRequest = () =>
      searchRequestIdRef.current === requestId && !controller.signal.aborted;
    setLoading(true);
    setError("");
    setSourceWarnings([]);
    Promise.all([
      withSearchRequestTimeout(
        controller.signal,
        SEARCH_REQUEST_TIMEOUT_MS,
        async (signal) => {
          const response = await fetch(
            `/api/search?${new URLSearchParams({ q: query, safe: safeSearch ? "strict" : "off" })}`,
            { signal },
          );
          if (!response.ok) throw new Error("search");
          return response.json() as Promise<Partial<Payload>>;
        },
      ),
      withSearchRequestTimeout(
        controller.signal,
        OPTIONAL_SEARCH_SOURCE_TIMEOUT_MS,
        async (signal) => {
          const response = await fetch("/music/api/tracks", { signal });
          if (!response.ok) return { data: null, failed: true };
          const result = await response.json() as unknown;
          return {
            data: { tracks: normalizeWorkerMusicSearchTracks(result) },
            failed: false,
          };
        },
      ).catch((reason: unknown) => {
        if (controller.signal.aborted) throw reason;
        return { data: null, failed: true };
      }),
    ])
      .then(([core, musicSource]) => {
        if (!isCurrentRequest()) return;
        const music = musicSource.data;
        setSourceWarnings([
          ...(musicSource.failed ? ["Music"] : []),
        ]);
        const matches = (values: string[]) => {
          const needle = normalizeSearchValue(query);
          return (
            values.some((value) =>
              normalizeSearchValue(value).includes(needle),
            ) ||
            scoreSearchFields(
              query,
              values.map((value, index) => ({
                value,
                weight: index === 0 ? 8 : 2,
              })),
            ) > 0
          );
        };
        const tracks = (music?.tracks ?? [])
          .filter((item) =>
            matches([item.title, item.artist, item.description]),
          )
          .slice(0, 20);
        setData({
          ...EMPTY,
          ...core,
          counts: {
            ...(core.counts ?? {}),
            music: tracks.length,
          },
          music: tracks,
        });
      })
      .catch((reason: unknown) => {
        if (!isCurrentRequest()) return;
        const timedOut = reason instanceof SearchRequestTimeoutError;
        setError(
          timedOut
            ? locale === "ja"
              ? "検索がタイムアウトしました。接続を確認して再試行してください。"
              : "Search timed out. Check your connection and try again."
            : locale === "ja"
              ? "検索できませんでした。"
              : "Search failed.",
        );
      })
      .finally(() => {
        if (isCurrentRequest()) setLoading(false);
      });
    return () => controller.abort();
  }, [locale, query, retryNonce, safeSearch]);

  const suggestions = useMemo(() => {
    const needle = normalizeSearchValue(draft);
    if (!needle || normalizeSearchValue(query) === needle) return [];
    const candidates = [
      ...history.map((label) => ({
        label,
        detail: "最近の検索",
        kind: "history",
      })),
      ...discovery.posts.map((item) => ({
        label: item.displayName,
        detail: item.body,
        kind: "ユーザー・投稿",
      })),
      ...discovery.threads.map((item) => ({
        label: item.title,
        detail: item.boardTitle,
        kind: "スレッド",
      })),
      ...discovery.hubpedia.map((item) => ({
        label: item.title,
        detail: item.category,
        kind: "Hubpedia",
      })),
    ];
    const matching = candidates
      .filter((item) =>
        normalizeSearchValue(`${item.label} ${item.detail}`).includes(needle),
      )
      .slice(0, 6);
    return [
      ...matching,
      {
        label: draft.trim(),
        detail: `Hub全体で「${draft.trim()}」を検索`,
        kind: "direct",
      },
    ].filter(
      (item, index, items) =>
        item.label &&
        items.findIndex((candidate) => candidate.label === item.label) ===
          index,
    );
  }, [discovery, draft, history, query]);

  const proactiveAnswers = useMemo(() => {
    const answers: Array<{
      id: string;
      eyebrow: string;
      title: string;
      summary: string;
      href: string;
      reason: string;
    }> = [];
    const recentQuery = history[0]?.trim();
    if (recentQuery) {
      answers.push({
        id: `history:${recentQuery}`,
        eyebrow: locale === "ja" ? "続きから" : "Continue",
        title: recentQuery,
        summary:
          locale === "ja"
            ? "前回の検索を、最新のHub全体の結果で確認します。"
            : "Check your previous search against the latest results across Hub.",
        href: `/search?q=${encodeURIComponent(recentQuery)}`,
        reason:
          locale === "ja"
            ? "この端末の直近の検索履歴に基づいています。"
            : "Based on recent search history stored on this device.",
      });
    }
    const thread = discovery.threads[0];
    if (thread) {
      answers.push({
        id: `thread:${thread.id}`,
        eyebrow: locale === "ja" ? "いま確認" : "Check now",
        title: thread.title,
        summary:
          locale === "ja"
            ? `${thread.boardTitle}で更新された話題です。${thread.postCount}件の投稿があります。`
            : `Recently updated in ${thread.boardTitle}, with ${thread.postCount} posts.`,
        href: `/threads/${thread.id}`,
        reason:
          locale === "ja"
            ? "更新時刻と会話の動きを基に選びました。"
            : "Selected from recency and discussion activity.",
      });
    }
    const article = discovery.hubpedia[0];
    if (article) {
      answers.push({
        id: `hubpedia:${article.slug}`,
        eyebrow: locale === "ja" ? "背景を理解" : "Understand",
        title: article.title,
        summary: article.summary,
        href: hubpediaArticleHref(article.slug),
        reason:
          locale === "ja"
            ? "現在の発見候補と関連する基礎知識として選びました。"
            : "Selected as useful background for current discovery topics.",
      });
    }
    const post = discovery.posts[0];
    if (post && answers.length < 3) {
      answers.push({
        id: `post:${post.id}`,
        eyebrow: locale === "ja" ? "注目の投稿" : "Notable post",
        title: post.displayName,
        summary: post.body,
        href: `/posts/${post.id}`,
        reason:
          locale === "ja"
            ? "公開反応と新しさを基に選びました。"
            : "Selected from public engagement and recency.",
      });
    }
    return answers.slice(0, 3);
  }, [discovery, history, locale]);

  const allHits = useMemo(
    () => uniqueSearchHits(toHits(data, query)),
    [data, query],
  );
  const availableKinds = useMemo(
    () => new Set(allHits.map((item) => item.kind)),
    [allHits],
  );
  const hits = useMemo(() => {
    const allowed = kind === "all" ? GROUPS[group] : [kind];
    const maximum = Number(maximumPrice);
    const regionNeedle = normalizeSearchValue(region);
    const categoryNeedle = normalizeSearchValue(category);
    const now = Date.now();
    const periodMilliseconds =
      period === "day"
        ? 86_400_000
        : period === "week"
          ? 604_800_000
          : period === "month"
            ? 2_592_000_000
            : period === "year"
              ? 31_536_000_000
              : 0;
    const selected = allHits.filter((item) => {
      if (!allowed.includes(item.kind)) return false;
      if (language !== "any" && item.language !== language) return false;
      if (
        Number.isFinite(maximum) &&
        maximum > 0 &&
        item.price !== null &&
        item.price > maximum
      )
        return false;
      if (
        regionNeedle &&
        !normalizeSearchValue(item.region).includes(regionNeedle)
      )
        return false;
      if (
        categoryNeedle &&
        !normalizeSearchValue(item.category).includes(categoryNeedle)
      )
        return false;
      if (periodMilliseconds && item.createdAt) {
        const created = Date.parse(item.createdAt);
        if (Number.isFinite(created) && now - created > periodMilliseconds)
          return false;
      } else if (periodMilliseconds && !item.createdAt) {
        return false;
      }
      return true;
    });
    return selected.sort((left, right) =>
      sort === "newest"
        ? right.createdAt.localeCompare(left.createdAt)
        : sort === "popular"
          ? right.popularity - left.popularity
          : right.score - left.score,
    );
  }, [
    allHits,
    category,
    group,
    kind,
    language,
    maximumPrice,
    period,
    region,
    sort,
  ]);
  const alternatives = useMemo(() => searchAlternatives(query), [query]);
  const intent = useMemo(() => inferSearchIntent(query), [query]);
  const orderedGroups = useMemo(() => {
    const values = Object.keys(GROUPS) as SearchGroup[];
    const populated = values.filter(
      (value) =>
        value === "all" ||
        value === group ||
        GROUPS[value].some((resultKind) => availableKinds.has(resultKind)),
    );
    if (!intent.preferredGroup || !populated.includes(intent.preferredGroup))
      return populated;
    return [
      "all",
      intent.preferredGroup,
      ...populated.filter(
        (value) => value !== "all" && value !== intent.preferredGroup,
      ),
    ] as SearchGroup[];
  }, [availableKinds, group, intent.preferredGroup]);
  const visibleKinds = useMemo(
    () =>
      GROUPS[group].filter(
        (value) => value === kind || availableKinds.has(value),
      ),
    [availableKinds, group, kind],
  );
  const intentRank = useMemo(
    () =>
      new Map(
        intent.preferredKinds.map((value, index) => [
          value,
          intent.preferredKinds.length - index,
        ]),
      ),
    [intent.preferredKinds],
  );

  const rankedHits = useMemo(() => {
    if (sort !== "relevant" || intentRank.size === 0) return hits;
    return [...hits].sort((left, right) => {
      const intentDifference =
        (intentRank.get(right.kind) ?? 0) - (intentRank.get(left.kind) ?? 0);
      return intentDifference || right.score - left.score;
    });
  }, [hits, intentRank, sort]);
  const postById = useMemo(
    () => new Map(data.posts.map((post) => [post.id, post] as const)),
    [data.posts],
  );

  function runSearch(value: string) {
    const normalized = value.trim();
    if (!normalized) {
      setQuery("");
      setDraft("");
      setGroup("all");
      setKind("all");
      setSort("relevant");
      clearDetailFilters();
      setError("");
      setSuggestionIndex(-1);
      setSuggestionsOpen(false);
      if (`${window.location.pathname}${window.location.search}` !== "/search")
        window.history.pushState(null, "", "/search");
      return;
    }
    const nextHistory = [
      normalized,
      ...history.filter((item) => item !== normalized),
    ].slice(0, 10);
    setHistory(nextHistory);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    const params = new URLSearchParams();
    params.set("q", normalized);
    if (group !== "all") params.set("group", group);
    if (kind !== "all") params.set("type", kind);
    if (sort !== "relevant") params.set("sort", sort);
    if (period !== "any") params.set("period", period);
    if (language !== "any") params.set("language", language);
    if (maximumPrice) params.set("maxPrice", maximumPrice);
    if (region) params.set("region", region);
    if (category) params.set("category", category);
    const next = `/search?${params}`;
    if (`${window.location.pathname}${window.location.search}` !== next)
      window.history.pushState(null, "", next);
    setQuery(normalized);
    setDraft(normalized);
    setSuggestionIndex(-1);
    setSuggestionsOpen(false);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    runSearch(draft);
  }
  function selectGroup(value: SearchGroup) {
    setGroup(value);
    setKind("all");
  }
  function clearDetailFilters() {
    setPeriod("any");
    setLanguage("any");
    setMaximumPrice("");
    setRegion("");
    setCategory("");
  }
  /*
   * Four-region layout: the page's own switcher — discovery tabs without a
   * query, result groups with one — lives in the page-left column through
   * the shared bbs-* column contract, like the feed and the notifications.
   */
  return (
    <div className="search-directory-layout bbs-directory-layout tab-left-column-layout">
      <button
        type="button"
        className="bbs-directory-mobile-toggle"
        onClick={() => setSearchDirectoryOpen((open) => !open)}
        aria-controls="search-directory"
        aria-expanded={searchDirectoryOpen}
      >
        {locale === "ja" ? "検索の切替" : "Search sections"}
      </button>
      {searchDirectoryOpen ? (
        <button type="button" className="bbs-directory-backdrop" onClick={() => setSearchDirectoryOpen(false)} aria-label={locale === "ja" ? "閉じる" : "Close"} />
      ) : null}
      <aside
        id="search-directory"
        data-hub-page-left-column
        className={`search-directory bbs-thread-directory tab-left-column${searchDirectoryOpen ? " bbs-thread-directory--open" : ""}`}
        aria-label={locale === "ja" ? "検索" : "Search"}
      >
        <header className="bbs-thread-directory__header tab-left-column__header">
          <div>
            <strong>{locale === "ja" ? "検索" : "Search"}</strong>
          </div>
          <button type="button" onClick={() => setSearchDirectoryOpen(false)} aria-label={locale === "ja" ? "閉じる" : "Close"}>×</button>
        </header>
        {!query ? (
          <nav
            className="bbs-thread-directory__nav feed-directory__nav"
            aria-label={locale === "ja" ? "発見" : "Discover"}
            role="tablist"
          >
            {(
              [
                ["recommended", locale === "ja" ? "おすすめ" : "For you"],
                ["trends", locale === "ja" ? "トレンド" : "Trends"],
                ["news", locale === "ja" ? "ニュース" : "News"],
                ["images", locale === "ja" ? "画像・作品" : "Images & works"],
              ] as Array<[DiscoveryTab, string]>
            ).map(([value, label]) => (
              <button
                type="button"
                role="tab"
                id={`search-discovery-tab-${value}`}
                aria-controls="search-discovery-panel"
                aria-selected={discoveryTab === value}
                tabIndex={discoveryTab === value ? 0 : -1}
                key={value}
                className={`tl-tab${discoveryTab === value ? " tl-tab--active" : ""}`}
                onKeyDown={(event) =>
                  moveTabFocus(
                    event,
                    ["recommended", "trends", "news", "images"],
                    discoveryTab,
                    setDiscoveryTab,
                  )
                }
                onClick={() => { setDiscoveryTab(value); setSearchDirectoryOpen(false); }}
              >
                {label}
              </button>
            ))}
          </nav>
        ) : (
          <nav
            className="bbs-thread-directory__nav feed-directory__nav"
            aria-label={locale === "ja" ? "検索対象" : "Search group"}
            role="tablist"
          >
            {orderedGroups.map((value) => (
              <button
                type="button"
                role="tab"
                aria-selected={group === value}
                tabIndex={group === value ? 0 : -1}
                key={value}
                className={`tl-tab${group === value ? " tl-tab--active" : ""}`}
                onKeyDown={(event) =>
                  moveTabFocus(event, orderedGroups, group, selectGroup)
                }
                onClick={() => { selectGroup(value); setSearchDirectoryOpen(false); }}
              >
                {GROUP_LABELS[value][locale === "ja" ? "ja" : "en"]}
              </button>
            ))}
          </nav>
        )}
      </aside>
      <div className="search-directory-content bbs-directory-content">
    <div className="search-page search-experience">
      {showHeading || showSearchForm ? <header>
        {showHeading ? <h1>{locale === "ja" ? "検索" : "Search"}</h1> : null}
        {showSearchForm ? <form role="search" aria-label={locale === "ja" ? "Hubを検索" : "Search Hub"} onSubmit={submit}>
          <label className="search-primary-field">
            <span className="hub-sr-only">{locale === "ja" ? "検索語" : "Search terms"}</span>
            <UiInput
              ref={inputRef}
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestionsOpen && Boolean(suggestions.length)}
              aria-controls="hub-search-suggestions"
              aria-activedescendant={
                suggestionsOpen && suggestionIndex >= 0
                  ? `hub-search-suggestion-${suggestionIndex}`
                  : undefined
              }
              value={draft}
              onFocus={() => {
                if (suggestions.length) setSuggestionsOpen(true);
              }}
              onChange={(event) => {
                setDraft(event.target.value);
                setSuggestionIndex(-1);
                setSuggestionsOpen(true);
              }}
              onKeyDown={(event) => {
                if (!suggestions.length) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSuggestionsOpen(true);
                  setSuggestionIndex((index) =>
                    Math.min(index + 1, suggestions.length - 1),
                  );
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSuggestionsOpen(true);
                  setSuggestionIndex((index) =>
                    index < 0 ? suggestions.length - 1 : Math.max(index - 1, 0),
                  );
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSuggestionIndex(-1);
                  setSuggestionsOpen(false);
                }
                if (event.key === "Enter" && suggestionIndex >= 0) {
                  event.preventDefault();
                  runSearch(suggestions[suggestionIndex]?.label ?? draft);
                }
              }}
              placeholder={
                locale === "ja"
                  ? "投稿、ユーザー、画像、商品などを検索"
                  : "Search posts, people, media, products, and more"
              }
              autoComplete="off"
            />
          </label>
          <SearchSubmitButton label={locale === "ja" ? "検索" : "Search"} />
        </form> : null}
        {showSearchForm && suggestionsOpen && suggestions.length ? (
          <div
            id="hub-search-suggestions"
            className="search-suggestions"
            role="listbox"
          >
            {suggestions.map((item, index) => (
              <button
                id={`hub-search-suggestion-${index}`}
                role="option"
                aria-selected={suggestionIndex === index}
                type="button"
                key={`${item.kind}:${item.label}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runSearch(item.label)}
              >
                <span>{item.kind}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        ) : null}
      </header> : null}

      {!query ? (
        <>
          {proactiveReady ? (
            <section className="search-proactive" aria-labelledby="search-proactive-title">
              <div className="search-proactive__heading">
                <div>
                  <span>{locale === "ja" ? "質問する前に" : "Before you ask"}</span>
                  <h2 id="search-proactive-title">
                    {locale === "ja" ? "今、役立ちそうな答え" : "Answers that may help now"}
                  </h2>
                </div>
                <button
                  type="button"
                  aria-pressed={proactiveEnabled}
                  onClick={() => {
                    const next = !proactiveEnabled;
                    setProactiveEnabled(next);
                    localStorage.setItem(PROACTIVE_SEARCH_KEY, String(next));
                  }}
                >
                  {proactiveEnabled
                    ? locale === "ja" ? "先回りを停止" : "Turn off"
                    : locale === "ja" ? "先回りを有効化" : "Turn on"}
                </button>
              </div>
              {proactiveEnabled ? (
                proactiveAnswers.length ? (
                  <div className="search-proactive__answers">
                    {proactiveAnswers.map((answer) => (
                      <article key={answer.id}>
                        <span>{answer.eyebrow}</span>
                        <h3><a href={answer.href}>{answer.title}</a></h3>
                        <p>{answer.summary}</p>
                        {proactiveReasonOpen ? <small>{answer.reason}</small> : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="search-proactive__empty">
                    {locale === "ja"
                      ? "利用するほど、ここに続きや候補が表示されます。"
                      : "As you use Hub, useful continuations will appear here."}
                  </p>
                )
              ) : (
                <p className="search-proactive__empty">
                  {locale === "ja"
                    ? "先回り候補はこの端末で停止しています。"
                    : "Proactive suggestions are off on this device."}
                </p>
              )}
              {proactiveEnabled && proactiveAnswers.length ? (
                <button
                  className="search-proactive__reason"
                  type="button"
                  aria-expanded={proactiveReasonOpen}
                  onClick={() => setProactiveReasonOpen((open) => !open)}
                >
                  {proactiveReasonOpen
                    ? locale === "ja" ? "理由を隠す" : "Hide reasons"
                    : locale === "ja" ? "なぜ表示される？" : "Why these?"}
                </button>
              ) : null}
            </section>
          ) : null}
          {history.length ? (
            <section className="search-memory">
              <div>
                <h2>最近の検索</h2>
                <button
                  className="hub-icon-button"
                  type="button"
                  aria-label="検索履歴をすべて削除"
                  title="検索履歴をすべて削除"
                  onClick={() => {
                    setHistory([]);
                    localStorage.removeItem(HISTORY_KEY);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
              {history.map((item) => (
                <span key={item}>
                  <button type="button" onClick={() => runSearch(item)}>
                    {item}
                  </button>
                </span>
              ))}
            </section>
          ) : null}
          <section
            className="search-discovery"
            id="search-discovery-panel"
            role="tabpanel"
            aria-labelledby={`search-discovery-tab-${discoveryTab}`}
          >
            {discoveryTab === "trends" ? (
              trends ? (
                <div className="search-discovery__block search-discovery__trends">
                  <CommunityTrends {...trends} locale={locale} />
                </div>
              ) : (
                <UiStatePanel
                  className="search-discovery-status"
                  state="empty"
                  title={locale === "ja" ? "トレンドはまだありません" : "No trends yet"}
                  description={locale === "ja" ? "話題が集まると、ここにランキングが表示されます。" : "Rankings will appear here as topics gain activity."}
                />
              )
            ) : null}
            {discoveryTab === "recommended" ? (
              <>
                <div className="home-feed__stream search-post-results">
                  {discovery.posts.map((post) => (
                    <TweetCard
                      key={post.id}
                      post={asTimelinePost(post)}
                      locale={locale}
                      viewerProfileId={currentProfileId}
                    />
                  ))}
                </div>
                <div className="search-items">
                  {discovery.hubpedia.map((item) => (
                    <a key={item.slug} href={hubpediaArticleHref(item.slug)}>
                      <strong>{item.title}</strong>
                      <p>{item.summary}</p>
                      <small>Hubpedia · {item.category}</small>
                    </a>
                  ))}
                </div>
                {!discovery.posts.length && !discovery.hubpedia.length ? (
                  <div className="search-discovery-status search-discovery-starters">
                    <strong>
                      {locale === "ja"
                        ? "気になるものから探す"
                        : "Start with what interests you"}
                    </strong>
                    <p>
                      {locale === "ja"
                        ? "投稿が少ない間も、種類を選んですぐ横断検索できます。"
                        : "Choose a category to search across Hub, even while recommendations are still learning."}
                    </p>
                    <div
                      aria-label={
                        locale === "ja" ? "検索を始める" : "Start a search"
                      }
                    >
                      {[
                        [
                          locale === "ja" ? "いまの話題" : "Current topics",
                          locale === "ja" ? "最新 話題" : "latest topics",
                        ],
                        [
                          locale === "ja" ? "ユーザー" : "People",
                          locale === "ja" ? "ユーザー" : "people",
                        ],
                        [
                          locale === "ja" ? "画像・作品" : "Images & works",
                          locale === "ja" ? "画像 作品" : "images works",
                        ],
                        [
                          locale === "ja" ? "商品" : "Products",
                          locale === "ja"
                            ? "おすすめ 商品"
                            : "recommended products",
                        ],
                        [
                          locale === "ja" ? "質問・相談" : "Questions",
                          locale === "ja" ? "質問 相談" : "questions advice",
                        ],
                      ].map(([label, value]) => (
                        <button
                          type="button"
                          key={label}
                          onClick={() => runSearch(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
            {discoveryTab === "news" ? (
              discovery.threads.length ? (
                <div className="search-discovery__threads">
                  {discovery.threads.map((item) => (
                    <a key={item.id} href={`/threads/${item.id}`}>
                      <small>{item.boardTitle}</small>
                      <strong>{item.title}</strong>
                      <span>{item.postCount}件の投稿</span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="search-discovery-status">
                  <strong>
                    {locale === "ja"
                      ? "新しいニュースはありません"
                      : "No recent news"}
                  </strong>
                  <p>
                    {locale === "ja"
                      ? "新しい話題が投稿されるとここに表示されます。"
                      : "New discussions will appear here when they are posted."}
                  </p>
                </div>
              )
            ) : null}
            {discoveryTab === "images" ? (
              <div className="search-visual-discovery">
                <div className="home-feed__stream search-post-results">
                  {discovery.images.map((post) => (
                    <TweetCard
                      key={post.id}
                      post={asTimelinePost(post)}
                      locale={locale}
                      viewerProfileId={currentProfileId}
                    />
                  ))}
                </div>
                {!discovery.images.length ? (
                  <div className="search-discovery-status">
                    <strong>
                      {locale === "ja"
                        ? "画像はまだありません"
                        : "No images yet"}
                    </strong>
                    <p>
                      {locale === "ja"
                        ? "公開された画像投稿がここに表示されます。"
                        : "Published image posts will appear here."}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <>
          {group !== "all" && visibleKinds.length > 1 ? (
            <nav
              className="search-subfilters"
              aria-label={locale === "ja" ? "詳細分類" : "Result type"}
            >
              <button
                type="button"
                className={kind === "all" ? "active" : ""}
                onClick={() => setKind("all")}
              >
                {locale === "ja" ? "すべて" : "All"}
              </button>
              {visibleKinds.map((value) => (
                <button
                  type="button"
                  key={value}
                  className={kind === value ? "active" : ""}
                  onClick={() => setKind(value)}
                >
                  {KIND_LABELS[value][locale === "ja" ? "ja" : "en"]}
                </button>
              ))}
            </nav>
          ) : null}
          {/*
            * Google keeps one field, one tab row, then results, and folds the
            * rest behind "ツール". X does the same with its tab row. This page
            * stacked five control rows — saved views, groups, sort and safe
            * search, then five filters — 323px of chrome above the first
            * result. The tabs stay out front; the rest waits until asked for.
            */}
          <details className="search-tools-disclosure">
            <summary>{locale === "ja" ? "ツール" : "Tools"}</summary>
            <SavedQueryTabs
              surface="search"
              currentValue={query}
              onApply={runSearch}
              labels={
                locale === "ja"
                  ? undefined
                  : {
                      save: "Save current search",
                      placeholder: "Tab name",
                      aria: "Saved searches",
                    }
              }
            />
          <div className="search-tools">
            <label>
              {locale === "ja" ? "並び順" : "Sort"}
              <UiSelect
                value={sort}
                onChange={(event) => setSort(event.target.value as SortOrder)}
              >
                <option value="relevant">
                  {locale === "ja" ? "関連度" : "Relevance"}
                </option>
                <option value="newest">
                  {locale === "ja" ? "新着" : "Newest"}
                </option>
                <option value="popular">
                  {locale === "ja" ? "人気" : "Popular"}
                </option>
              </UiSelect>
            </label>
            <label className="search-safe-toggle">
              <input
                type="checkbox"
                checked={safeSearch}
                onChange={(event) => setSafeSearch(event.target.checked)}
              />
              {locale === "ja" ? "セーフサーチ" : "Safe search"}
            </label>
          </div>
          <section
            className="search-filter-panel"
            aria-label={
              locale === "ja" ? "検索結果の絞り込み" : "Filter search results"
            }
          >
            <label>
              {locale === "ja" ? "期間" : "Period"}
              <UiSelect
                value={period}
                onChange={(event) =>
                  setPeriod(event.target.value as PeriodFilter)
                }
              >
                <option value="any">
                  {locale === "ja" ? "指定なし" : "Any time"}
                </option>
                <option value="day">
                  {locale === "ja" ? "24時間以内" : "Past day"}
                </option>
                <option value="week">
                  {locale === "ja" ? "1週間以内" : "Past week"}
                </option>
                <option value="month">
                  {locale === "ja" ? "1か月以内" : "Past month"}
                </option>
                <option value="year">
                  {locale === "ja" ? "1年以内" : "Past year"}
                </option>
              </UiSelect>
            </label>
            <label>
              {locale === "ja" ? "言語" : "Language"}
              <UiSelect
                value={language}
                onChange={(event) =>
                  setLanguage(event.target.value as LanguageFilter)
                }
              >
                <option value="any">
                  {locale === "ja" ? "すべて" : "All"}
                </option>
                <option value="ja">日本語</option>
                <option value="en">English</option>
                <option value="ko">한국어</option>
                <option value="zh">中文</option>
                <option value="other">
                  {locale === "ja" ? "その他" : "Other"}
                </option>
              </UiSelect>
            </label>
            <label>
              {locale === "ja" ? "上限価格" : "Maximum price"}
              <UiInput
                type="number"
                min="0"
                inputMode="decimal"
                value={maximumPrice}
                onChange={(event) => setMaximumPrice(event.target.value)}
                placeholder={locale === "ja" ? "指定なし" : "No limit"}
              />
            </label>
            <label>
              {locale === "ja" ? "地域" : "Region"}
              <UiInput
                type="search"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                placeholder={
                  locale === "ja" ? "都道府県・地域" : "City or region"
                }
              />
            </label>
            <label>
              {locale === "ja" ? "カテゴリ" : "Category"}
              <UiInput
                type="search"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder={locale === "ja" ? "カテゴリ名" : "Category name"}
              />
            </label>
            <UiButton
              type="button"
              onClick={clearDetailFilters}
              disabled={
                period === "any" &&
                language === "any" &&
                !maximumPrice &&
                !region &&
                !category
              }
            >
              {locale === "ja" ? "絞り込みを解除" : "Clear filters"}
            </UiButton>
          </section>
          </details>
          {!loading && !error && sourceWarnings.length ? (
            <div className="search-source-warning" role="status">
              <span>
                {locale === "ja"
                  ? `${sourceWarnings.join("・")}の結果を取得できませんでした。ほかの検索結果を表示しています。`
                  : `${sourceWarnings.join(" and ")} results are unavailable. Other results are still shown.`}
              </span>
              <UiButton
                type="button"
                onClick={() => setRetryNonce((value) => value + 1)}
              >
                {locale === "ja" ? "再試行" : "Retry"}
              </UiButton>
            </div>
          ) : null}
          {loading ? (
            <UiStatePanel className="search-loading" state="loading" title={locale === "ja" ? "検索中…" : "Searching…"} />
          ) : error ? (
            <UiStatePanel className="search-empty" state="error" title={error} action={<UiButton type="button" onClick={() => setRetryNonce((value) => value + 1)}>再試行</UiButton>} />
          ) : rankedHits.length ? (
            <section
              className="search-mixed-results"
              aria-label={locale === "ja" ? "検索結果" : "Search results"}
            >
              {rankedHits.slice(0, 40).map((item) => {
                const post =
                  item.kind === "posts" ? postById.get(item.id) : null;
                if (post) {
                  return (
                    <TweetCard
                      key={`${item.kind}:${item.id}`}
                      post={asTimelinePost(post)}
                      locale={locale}
                      viewerProfileId={currentProfileId}
                      masonry
                    />
                  );
                }
                return (
                  <a
                    href={item.href}
                    className="search-hit"
                    data-search-kind={item.kind}
                    key={`${item.kind}:${item.id}`}
                  >
                    <div>
                      <span>
                        {KIND_LABELS[item.kind][locale === "ja" ? "ja" : "en"]}
                      </span>
                      <small>{item.reason}</small>
                    </div>
                    <strong>
                      <Highlight text={item.title} query={query} />
                    </strong>
                    {item.description ? (
                      <p>
                        <Highlight text={item.description} query={query} />
                      </p>
                    ) : null}
                    {item.meta ? <small>{item.meta}</small> : null}
                  </a>
                );
              })}
            </section>
          ) : (
            <div className="search-empty search-empty--recovery">
              <strong>
                {locale === "ja"
                  ? "一致する結果はありません"
                  : "No matching results"}
              </strong>
              <p>
                {locale === "ja"
                  ? "表記を変えるか、別の分類を検索してください。"
                  : "Try another spelling or search group."}
              </p>
              {alternatives.length ? (
                <div>
                  {alternatives.map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => runSearch(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
              <a href={`/hubpedia?q=${encodeURIComponent(query)}`}>
                {locale === "ja"
                  ? `Hubpediaで「${query}」を検索`
                  : `Search Hubpedia for “${query}”`}
              </a>
            </div>
          )}
          <section className="search-related">
            <h2>{locale === "ja" ? "関連検索" : "Related searches"}</h2>
            <div>
              {[`${query} とは`, `${query} 最新`, `${query} おすすめ`].map(
                (item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => runSearch(item)}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>
          </section>
        </>
      )}
    </div>
      </div>
    </div>
  );
}
