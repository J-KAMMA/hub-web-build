"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import { FirstPartyAdSlot } from "@/components/first-party-ad-slot";
import { V2LegacySearchImport } from "@/components/v2/v2-legacy-search-import";
import { SEARCH_TABS, type SearchTab } from "@/lib/search-tabs";
import { V2Post, type V2PostData } from "@/components/v2/v2-post";
import {
  SearchArticleResult,
  SearchHubpediaResult,
  SearchMusicResult,
  SearchPersonCard,
  SearchKindResult,
  SearchTagResult,
  SearchThreadResult,
  SearchVideoResult,
  type SearchHubpediaDetail,
  type SearchPersonDetail,
  type SearchVideoDetail,
} from "@/components/v2/v2-search-cards";
import { V2ImageSearch } from "@/components/v2/v2-image-search";
import { V2SearchTabs } from "@/components/v2/v2-search-tabs";
import { imageInterestTerms, rankHubImages } from "@/lib/image-recommendation";
import { isHubScopedRef } from "@/lib/platform/core-model";
import type {
  SearchArticleCard,
  SearchExtras,
  SearchKindCard,
  SearchMusicCard,
  SearchTagCard,
  SearchThreadCard,
} from "@/lib/search-extras";
import type { HubCoreSearchEntity } from "@/lib/platform/search-core-adapter";
import { inferSearchIntent, normalizeSearchValue, searchAlternatives } from "@/lib/search-relevance";
import {
  appendHubSearchFilters,
  EMPTY_HUB_SEARCH_FILTERS,
  HUB_SEARCH_LANGUAGES,
  HUB_SEARCH_TYPES,
  hasHubSearchFilters,
  hubSearchFiltersKey,
  parseHubSearchFilters,
  type HubSearchFilters,
} from "@/lib/search-filters";
import {
  getSavedHubSearchKey as savedSearchKey, parseSavedHubSearches, planLegacyHubSearchImport,
  readLegacySurfaceSearches, serializeSavedHubSearches, type LegacyHubSearchCandidate, type SavedHubSearch,
} from "@/lib/v2-saved-searches";
import { SAVED_SURFACE_QUERY_STORAGE_KEY } from "@/lib/saved-surface-queries";

/*
 * v2 の検索。既存の search-experience.tsx（2,100行）とは別物で、既存には触れない。
 *
 * 落とさなかったもの（docs/HUB_V2_FEATURE_EXTRACTION.md の検索の項）:
 *   - NFKC の正規化。既存と同じ normalizeSearchValue を使う。別実装にしない
 *   - 履歴10件。鍵は既存と同じ hub.search.history。v1とv2で履歴を共有する
 *   - URL と状態の往復（?q= と ?group=）。戻る・進む・共有・ブックマークが効く
 *   - 6つのグループと、実在する種別だけを出す
 *   - 0件のときの綴りの候補と Hubpedia への誘導
 *   - 10秒の打ち切り、失敗と再試行
 *
 * 入力中の候補と保存した検索条件は、検索送信時に絞り込み条件も同じ形で復元する。
 * 結果は API の coreEntities だけを使う。14種の結果が「題と行き先」の同じ形に
 * 揃っていて、種別ごとに行き先を組み立て直す必要がない。
 * boards・lists も共通エンティティへ変換し、掲示板や公開リストの行き先を
 * 他の検索結果と同じ形式で扱う。API の件数はグループ札にも出し、切り替える
 * 前に結果の規模が分かるようにする。
 *
 * 画像は coreEntities には無いが、検索のAPIは最初から images を返していた
 * （v1 の検索はそれで格子を出している）。v2 は受け取らずに捨てていたので、
 * 構想 第5章「画像検索は外部Web画像検索ではなく、Hub内の画像発見機能」が
 * v2 だけ無かった。2026-09-04 に格子を足し、2026-09-09 に同画面の
 * 拡大表示と前後移動、読み込み失敗時の代替表示を足した。2026-09-09 に
 * 同じ検索結果から関連画像を順位付けして開く導線も足した。
 * 2026-09-09 に読み込み済みの検索結果を縦方向へ追加表示する導線を足した。
 * 2026-09-09 に画像検索の広告枠と、プレビュー内のキーボードフォーカス循環を足した。
 * 2026-09-09 にAPIの署名付きカーソルを使う追加取得を足した（秘密が未設定の
 * 開発環境では従来の全件レスポンスへ静かに戻る）。
 * 安全は元の問いが持っている（published・safety_status clean・メタデータ除去済み・
 * 見える投稿だけ）。ここで緩めない。
 */

const HISTORY_KEY = "hub.search.history";
const HISTORY_LIMIT = 10;
const SAVED_SEARCHES_KEY = "hub.search.saved";
const SAVED_SEARCHES_LIMIT = 10;
const RETURN_FOCUS_KEY = "hub.search.return-focus";
const RETURN_RESULTS_KEY = "hub.search.return-results";
const TIMEOUT_MS = 10_000;
const SEARCH_RESULT_PAGE_SIZE = 40;
const SEARCH_MORE_PAGE_SIZE = 20;

/*
 * 札ごとの「もっと見る」（/api/search/more）。最初の応答は種類ごとに 20 件（記事は 12 件）までなので、
 * それに満たない種類は続きが無い。続きは新しい順で、カーソルで 20 件ずつ取る。
 */
const MORE_KIND_BY_GROUP: Partial<Record<SearchGroup, { kind: string; firstPage: number }>> = {
  posts: { kind: "posts", firstPage: 20 },
  articles: { kind: "articles", firstPage: 12 },
  threads: { kind: "threads", firstPage: 20 },
  hubpedia: { kind: "hubpedia", firstPage: 20 },
  games: { kind: "games", firstPage: 12 },
  research: { kind: "research", firstPage: 12 },
  federated: { kind: "federated", firstPage: 12 },
  people: { kind: "profiles", firstPage: 20 },
};
const RETURN_RESULTS_MAX_COUNT = SEARCH_RESULT_PAGE_SIZE * 5;
const RETURN_RESULTS_MAX_REQUESTS = 5;
const RETURN_RESULTS_TTL_MS = 5 * 60_000;

type ReturnResultsState = {
  version: 1;
  location: string;
  targetHref: string;
  visibleCount: number;
  expiresAt: number;
};

/* 種類の札（2026-10-28）。X の検索のように、箱の直下に1行で並べる。一覧は lib/search-tabs.ts。 */
export type SearchGroup = SearchTab;
export type SearchOrder = "recommended" | "kind";

export type SearchCountKey =
  | "boards"
  | "profiles"
  | "threads"
  | "posts"
  | "images"
  | "hubpedia"
  | "communities"
  | "videos"
  | "products"
  | "lists"
  | "tokens"
  | "work"
  | "listings";

export type SearchCounts = Partial<Record<SearchCountKey, number>>;

/*
 * 札ごとに受け持つ結果の種類（sourceGroup）。画像は coreEntities ではなく images の道で来る。
 * 記事・音楽・タグは extras の道（API の応答の extras）で来る。
 */
const TAB_SOURCES: Record<Exclude<SearchGroup, "all">, readonly string[]> = {
  posts: ["posts"],
  articles: ["articles"],
  videos: ["videos"],
  images: [],
  music: ["music"],
  threads: ["threads", "boards"],
  hubpedia: ["hubpedia"],
  games: ["games"],
  research: ["research"],
  federated: ["federated"],
  people: ["profiles"],
  tags: ["tags"],
};

/* 続きの取得（署名つきカーソル）が効く札。記事・音楽・タグ・画像は最初の応答で全部来る。 */
const TABS_WITH_CURSOR = new Set<SearchGroup>(["all", "posts", "videos", "threads", "hubpedia", "people"]);

const GROUPS: { id: SearchGroup; ja: string; en: string }[] = [
  { id: "all", ja: "すべて", en: "All" },
  { id: "posts", ja: "投稿", en: "Posts" },
  { id: "articles", ja: "記事", en: "Articles" },
  { id: "videos", ja: "動画", en: "Videos" },
  { id: "images", ja: "画像", en: "Images" },
  { id: "music", ja: "音楽", en: "Music" },
  { id: "threads", ja: "スレッド", en: "Threads" },
  { id: "hubpedia", ja: "Hubpedia", en: "Hubpedia" },
  { id: "games", ja: "ゲーム", en: "Games" },
  { id: "research", ja: "研究", en: "Research" },
  { id: "federated", ja: "他のハブ", en: "Other Hubs" },
  { id: "people", ja: "人物", en: "People" },
  { id: "tags", ja: "タグ", en: "Tags" },
];

/* 並び順。API の order は recommended と kind だけ（結果の実体は日付を持たないので新しい順は無い）。 */
const ORDERS: { id: SearchOrder; ja: string; en: string }[] = [
  { id: "recommended", ja: "おすすめ", en: "Recommended" },
  { id: "kind", ja: "種類順", en: "By kind" },
];

const SEARCH_SOURCE_ORDER = [
  "profiles",
  "communities",
  "posts",
  "threads",
  "boards",
  "hubpedia",
  "articles",
  "music",
  "games",
  "research",
  "federated",
  "videos",
  "products",
  "lists",
  "tokens",
  "work",
  "listings",
  "tags",
] as const;

const SEARCH_SOURCE_RANK = new Map<string, number>(SEARCH_SOURCE_ORDER.map((source, index) => [source, index]));

/* 画面に並べる1件。coreEntities と extras を同じ形にして、並べ替えと札の絞り込みを共通にする。 */
type SearchItem = { sourceGroup: string; id: string; href: string; title: string; score?: number };

function orderByKind<T extends { sourceGroup: string }>(entities: T[]): T[] {
  return entities
    .map((entity, index) => ({ entity, index }))
    .sort((left, right) =>
      (SEARCH_SOURCE_RANK.get(left.entity.sourceGroup) ?? SEARCH_SOURCE_ORDER.length)
      - (SEARCH_SOURCE_RANK.get(right.entity.sourceGroup) ?? SEARCH_SOURCE_ORDER.length)
      || left.index - right.index,
    )
    .map(({ entity }) => entity);
}

/*
 * 「おすすめ」は1つの点数で並べる（2026-10-30）。点数はサーバーが付ける（本文の一致度・新しさ・
 * 反応・フォロー。lib/search-score.ts）。点のない記事・音楽などは中くらいの点で混ぜる。
 * 質問の意図が指す種類には少しだけ上乗せする。種類ごとの順番交替はしない。
 * 1つの札の中は届いた順のまま（続きを後ろに足すため）。
 */
const UNSCORED_RESULT = 0.45;

function orderByRecommended<T extends { sourceGroup: string; score?: number }>(entities: T[], query: string, group: SearchGroup): T[] {
  if (group !== "all") return entities;
  const preferredKinds = inferSearchIntent(query).preferredKinds.filter((kind) => SEARCH_SOURCE_RANK.has(kind));
  const bonus = new Map(preferredKinds.map((kind, index) => [kind, 0.1 / (index + 1)]));
  if (!bonus.size && !entities.some((entity) => typeof entity.score === "number")) return entities;
  return entities
    .map((entity, index) => ({
      entity,
      index,
      value: (typeof entity.score === "number" && Number.isFinite(entity.score) ? entity.score : UNSCORED_RESULT) + (bonus.get(entity.sourceGroup) ?? 0),
    }))
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .map(({ entity }) => entity);
}

/* 旧い札の値（social など）や壊れた値は「すべて」へ。 */
function normalizeGroup(value: string | null | undefined): SearchGroup {
  return (SEARCH_TABS as readonly string[]).includes(value ?? "") ? (value as SearchGroup) : "all";
}

const KIND_LABEL: Record<string, { ja: string; en: string }> = {
  posts: { ja: "投稿", en: "Post" },
  profiles: { ja: "人物", en: "Person" },
  communities: { ja: "コミュニティ", en: "Community" },
  videos: { ja: "動画", en: "Video" },
  images: { ja: "画像", en: "Image" },
  hubpedia: { ja: "Hubpedia", en: "Hubpedia" },
  threads: { ja: "スレッド", en: "Thread" },
  boards: { ja: "掲示板", en: "Board" },
  products: { ja: "商品", en: "Product" },
  lists: { ja: "リスト", en: "List" },
  listings: { ja: "掲載", en: "Listing" },
  work: { ja: "仕事", en: "Work" },
  tokens: { ja: "トークン", en: "Token" },
  articles: { ja: "記事", en: "Article" },
  games: { ja: "ゲーム", en: "Game" },
  research: { ja: "研究", en: "Research" },
  federated: { ja: "他のハブ", en: "Other Hub" },
  music: { ja: "音楽", en: "Music" },
  tags: { ja: "タグ", en: "Tag" },
};

export type SearchImageHit = {
  id: string;
  body: string;
  handle: string | null;
  displayName: string;
  productHref?: string;
  images?: { id: string; url: string; fullUrl: string; width: number | null; height: number | null; altText: string | null }[];
};

type SearchImageTile = {
  key: string;
  postId: string;
  url: string;
  fullUrl: string;
  width: number | null;
  height: number | null;
  alt: string;
  href: string;
  destination: "post" | "product";
  caption: string;
};

const SEARCH_IMAGE_DIMENSION_LIMIT = 1600;

function imageAspectRatio(width: number | null | undefined, height: number | null | undefined): string | undefined {
  if (typeof width !== "number" || typeof height !== "number"
    || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1
    || width > SEARCH_IMAGE_DIMENSION_LIMIT || height > SEARCH_IMAGE_DIMENSION_LIMIT) {
    return undefined;
  }
  return `${width} / ${height}`;
}

type SearchImage = NonNullable<SearchImageHit["images"]>[number];

function normalizeProductImageHref(value: string | undefined): string | null {
  const match = /^\/market\/products\/([^/?#]+)$/.exec(value?.trim() ?? "");
  if (!match) return null;
  let productId: string;
  try {
    productId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!productId || /[/\\\u0000-\u001f\u007f]/u.test(productId)) return null;
  return `/market/products/${encodeURIComponent(productId)}`;
}

function imageTileFromHit(hit: SearchImageHit, image: SearchImage): SearchImageTile {
  const productHref = normalizeProductImageHref(hit.productHref);
  const isProduct = productHref !== null;
  return {
    key: image.id,
    postId: hit.id,
    url: image.url,
    fullUrl: image.fullUrl || image.url,
    width: image.width,
    height: image.height,
    alt: image.altText ?? "",
    href: isProduct ? productHref! : `/v2/posts/${encodeURIComponent(hit.id)}`,
    destination: isProduct ? "product" : "post",
    caption: hit.body.slice(0, 60),
  };
}

export type SearchPayload = {
  query: string;
  coreEntities: HubCoreSearchEntity[];
  counts?: SearchCounts;
  images?: SearchImageHit[];
  nextCursor?: string | null;
  hasMore?: boolean;
  /* 記事・音楽・タグ、タグだけで当たったもの、投稿の札。最初の応答にだけ付く。 */
  extras?: SearchExtras;
  /* 人物・Hubpedia・スレッド・動画の札に出す補足（応答の本体の配列から取る）。 */
  profiles?: SearchPersonDetail[];
  hubpedia?: SearchHubpediaDetail[];
  threads?: SearchThreadCard[];
  videos?: SearchVideoDetail[];
  /* /api/search/more の games / research / federated の続き。 */
  kinds?: SearchKindCard[];
};

const SEARCH_ACTOR_KINDS = new Set(["human", "organization", "community", "agent", "service"]);
const SEARCH_OBJECT_KINDS = new Set([
  "post", "thread", "board", "list", "article", "video", "audio", "product", "job", "project",
  "property", "vehicle", "api", "model", "event", "contract",
]);
const SEARCH_COUNT_KEYS = new Set<SearchCountKey>([
  "boards", "profiles", "threads", "posts", "images", "hubpedia", "communities", "videos", "products",
  "lists", "tokens", "work", "listings",
]);
const SEARCH_CURSOR_LIMIT = 4096;
const SEARCH_TEXT_LIMIT = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSearchText(value: unknown): value is string {
  return typeof value === "string" && value.length <= SEARCH_TEXT_LIMIT;
}

function isSafeSearchHref(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value, "https://hub.invalid");
    return url.origin === "https://hub.invalid" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isSearchEntity(value: unknown): value is HubCoreSearchEntity {
  if (!isRecord(value) || !isHubScopedRef(value.ref) || value.ref.namespace !== "hub") return false;
  if (!isSearchText(value.title) || !isSafeSearchHref(value.href) || typeof value.sourceGroup !== "string") return false;
  if (!SEARCH_SOURCE_RANK.has(value.sourceGroup)) return false;
  if (value.entityType === "actor") return typeof value.actorKind === "string" && SEARCH_ACTOR_KINDS.has(value.actorKind);
  if (value.entityType === "object") return typeof value.objectKind === "string" && SEARCH_OBJECT_KINDS.has(value.objectKind);
  return false;
}

function isSafeSearchImageUrl(value: unknown, allowEmpty = false): value is string {
  if (typeof value !== "string" || value.length > SEARCH_CURSOR_LIMIT || (!allowEmpty && value === "")) return false;
  if (allowEmpty && value === "") return true;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value, "https://hub.invalid");
    if (url.origin === "https://hub.invalid") return value.startsWith("/") && !value.startsWith("//");
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isSearchImageDimension(value: unknown): value is number | null | undefined {
  return value === null || value === undefined
    || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= SEARCH_IMAGE_DIMENSION_LIMIT);
}

function parseSearchCounts(value: unknown): SearchCounts | undefined {
  if (!isRecord(value)) return undefined;
  const counts: SearchCounts = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!SEARCH_COUNT_KEYS.has(key as SearchCountKey)) continue;
    if (typeof candidate === "number" && Number.isInteger(candidate) && Number.isFinite(candidate) && candidate >= 0) {
      counts[key as SearchCountKey] = candidate;
    }
  }
  return Object.keys(counts).length ? counts : undefined;
}

function parseSearchImages(value: unknown): SearchImageHit[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((candidate): SearchImageHit[] => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id || candidate.id.length > SEARCH_CURSOR_LIMIT
      || !isSearchText(candidate.body) || !isSearchText(candidate.displayName)
      || (candidate.handle !== null && candidate.handle !== undefined && !isSearchText(candidate.handle))
      || !Array.isArray(candidate.images)) return [];
    const images = candidate.images.flatMap((image): NonNullable<SearchImageHit["images"]> => {
      if (!isRecord(image) || typeof image.id !== "string" || !image.id || image.id.length > SEARCH_CURSOR_LIMIT
        || !isSafeSearchImageUrl(image.url) || !isSafeSearchImageUrl(image.fullUrl, true)
        || (image.altText !== null && image.altText !== undefined && !isSearchText(image.altText))) return [];
      const width = isSearchImageDimension(image.width) && typeof image.width === "number" ? image.width : null;
      const height = isSearchImageDimension(image.height) && typeof image.height === "number" ? image.height : null;
      return [{
        id: image.id,
        url: image.url,
        fullUrl: image.fullUrl,
        width,
        height,
        altText: image.altText ?? null,
      }];
    });
    return [{
      id: candidate.id,
      body: candidate.body,
      handle: typeof candidate.handle === "string" ? candidate.handle : null,
      displayName: candidate.displayName,
      productHref: typeof candidate.productHref === "string" ? candidate.productHref : undefined,
      images,
    }];
  });
}

function isShortText(value: unknown, limit = SEARCH_TEXT_LIMIT): value is string {
  return typeof value === "string" && value.length <= limit;
}

function optionalImage(value: unknown): string | null {
  return typeof value === "string" && value !== "" && isSafeSearchImageUrl(value) ? value : null;
}

function parseList<T>(value: unknown, parse: (item: Record<string, unknown>) => T | null): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item): T[] => {
    if (!isRecord(item)) return [];
    const parsed = parse(item);
    return parsed ? [parsed] : [];
  });
}

function parseExtras(value: unknown): SearchExtras | undefined {
  if (!isRecord(value)) return undefined;
  const articles = parseList<SearchArticleCard>(value.articles, (a) => (
    isShortText(a.id, 200) && isShortText(a.title) && isSafeSearchHref(a.href) && isShortText(a.summary) && isShortText(a.author)
      ? {
          id: a.id,
          href: a.href,
          title: a.title,
          summary: a.summary,
          author: a.author,
          authorHandle: typeof a.authorHandle === "string" ? a.authorHandle : null,
          thumbnailUrl: optionalImage(a.thumbnailUrl),
          tags: Array.isArray(a.tags) ? a.tags.filter((tag): tag is string => isShortText(tag, 100)).slice(0, 5) : [],
          publishedAt: typeof a.publishedAt === "string" ? a.publishedAt : "",
        }
      : null
  )) ?? [];
  const music = parseList<SearchMusicCard>(value.music, (m) => (
    isShortText(m.id, 200) && isShortText(m.title) && isSafeSearchHref(m.href) && isShortText(m.artist)
      ? {
          id: m.id,
          href: m.href,
          title: m.title,
          artist: m.artist,
          genre: typeof m.genre === "string" ? m.genre : "",
          artworkUrl: optionalImage(m.artworkUrl),
          year: typeof m.year === "number" && Number.isFinite(m.year) ? m.year : null,
        }
      : null
  )) ?? [];
  const tags = parseList<SearchTagCard>(value.tags, (t) => (
    isShortText(t.name, 100) && t.name !== "" && isShortText(t.key, 100)
      ? { name: t.name, key: t.key, useCount: typeof t.useCount === "number" && Number.isFinite(t.useCount) ? t.useCount : 0 }
      : null
  )) ?? [];
  const threads = parseList<SearchThreadCard>(value.threads, (t) => (
    isShortText(t.id, 200) && isShortText(t.title) && isSafeSearchHref(t.href)
      ? {
          id: t.id,
          href: t.href,
          title: t.title,
          boardKey: typeof t.boardKey === "string" ? t.boardKey : "",
          postCount: typeof t.postCount === "number" && Number.isFinite(t.postCount) ? t.postCount : 0,
        }
      : null
  )) ?? [];
  /* A card that arrives locked is never drawn; the server already leaves those out. */
  const posts = (Array.isArray(value.posts) ? value.posts : []).filter((post): post is V2PostData => (
    isRecord(post) && isShortText(post.id, 200) && isShortText(post.body) && isShortText(post.displayName)
    && typeof post.createdAt === "string" && !post.accessGate
  ));
  const taggedPostIds = Array.isArray(value.taggedPostIds) ? value.taggedPostIds.filter((id): id is string => isShortText(id, 200)) : [];
  const followingProfileIds = Array.isArray(value.followingProfileIds)
    ? value.followingProfileIds.filter((id): id is string => isShortText(id, 200))
    : [];
  return { articles, music, tags, posts, taggedPostIds, threads, followingProfileIds, kinds: parseKindCards(value.kinds) ?? [] };
}

const KIND_CARD_NAMES: readonly string[] = ["products", "games", "research", "federated"];

function parseKindCards(value: unknown): SearchKindCard[] | undefined {
  return parseList<SearchKindCard>(value, (k) => (
    typeof k.kind === "string" && KIND_CARD_NAMES.includes(k.kind)
    && isShortText(k.id, 300) && isShortText(k.title) && isSafeSearchHref(k.href) && isShortText(k.summary)
      ? {
          kind: k.kind as SearchKindCard["kind"],
          id: k.id,
          href: k.href,
          title: k.title,
          summary: k.summary,
          ...(typeof k.host === "string" && k.host.length <= 255 ? { host: k.host } : {}),
          score: typeof k.score === "number" && Number.isFinite(k.score) ? k.score : 0.45,
        }
      : null
  ));
}

function parseProfiles(value: unknown): SearchPersonDetail[] | undefined {
  return parseList<SearchPersonDetail>(value, (p) => (
    isShortText(p.id, 200) && isShortText(p.handle, 200) && isShortText(p.displayName)
      ? { id: p.id, handle: p.handle, displayName: p.displayName, bio: typeof p.bio === "string" ? p.bio.slice(0, 200) : "", avatarUrl: optionalImage(p.avatarUrl) }
      : null
  ));
}

function parseHubpedia(value: unknown): SearchHubpediaDetail[] | undefined {
  return parseList<SearchHubpediaDetail>(value, (a) => (
    isShortText(a.slug, 300) && isShortText(a.title)
      ? {
          slug: a.slug,
          title: a.title,
          category: typeof a.category === "string" ? a.category : "",
          summary: typeof a.summary === "string" ? a.summary.slice(0, 200) : "",
        }
      : null
  ));
}

function parseRawThreads(value: unknown): SearchThreadCard[] | undefined {
  return parseList<SearchThreadCard>(value, (t) => (
    isShortText(t.id, 200) && isShortText(t.title)
      ? {
          id: t.id,
          href: "",
          title: t.title,
          boardKey: typeof t.boardKey === "string" ? t.boardKey : "",
          postCount: typeof t.postCount === "number" && Number.isFinite(t.postCount) ? t.postCount : 0,
        }
      : null
  ));
}

function parseVideos(value: unknown): SearchVideoDetail[] | undefined {
  return parseList<SearchVideoDetail>(value, (v) => (
    isShortText(v.id, 200) && isShortText(v.title)
      ? {
          id: v.id,
          title: v.title,
          channel: typeof v.channel === "string" ? v.channel : "",
          category: typeof v.category === "string" ? v.category : "",
          thumbnailUrl: v.gated === true ? null : optionalImage(v.thumbnailUrl),
          gated: v.gated === true,
        }
      : null
  ));
}

/* Network JSON is untrusted at the component boundary. Reject malformed result rows
 * before they reach Link, sorting, or cursor merging; optional presentation fields are
 * sanitized independently so one bad image cannot discard usable result entities. */
export function parseSearchPayload(value: unknown, expectedQuery?: string): SearchPayload | null {
  if (!isRecord(value) || !isSearchText(value.query) || !Array.isArray(value.coreEntities)
    || !value.coreEntities.every(isSearchEntity)) return null;
  if (expectedQuery !== undefined && normalizeSearchValue(value.query) !== normalizeSearchValue(expectedQuery)) return null;

  let nextCursor: string | null | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "nextCursor")) {
    if (value.nextCursor !== null && (typeof value.nextCursor !== "string"
      || value.nextCursor.length === 0 || value.nextCursor.length > SEARCH_CURSOR_LIMIT
      || /[\u0000-\u001f\u007f]/u.test(value.nextCursor))) return null;
    nextCursor = value.nextCursor as string | null;
  }
  let hasMore: boolean | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "hasMore")) {
    if (typeof value.hasMore !== "boolean") return null;
    hasMore = value.hasMore;
  }
  const hasCursor = typeof nextCursor === "string";
  /* Cursor pagination is a pair: a page that claims more results must carry
   * a fresh cursor, and a cursor must never be advertised as terminal. */
  if ((hasMore === true && !hasCursor) || (hasCursor && hasMore !== true)) return null;
  const payload: SearchPayload = { query: value.query, coreEntities: value.coreEntities };
  const counts = parseSearchCounts(value.counts);
  const images = parseSearchImages(value.images);
  if (counts) payload.counts = counts;
  if (images) payload.images = images;
  if (nextCursor !== undefined) payload.nextCursor = nextCursor;
  if (hasMore !== undefined) payload.hasMore = hasMore;
  const extras = parseExtras(value.extras);
  const profiles = parseProfiles(value.profiles);
  const hubpedia = parseHubpedia(value.hubpedia);
  const threads = parseRawThreads(value.threads);
  const videos = parseVideos(value.videos);
  const kinds = parseKindCards(value.kinds);
  if (kinds) payload.kinds = kinds;
  if (extras) payload.extras = extras;
  if (profiles) payload.profiles = profiles;
  if (hubpedia) payload.hubpedia = hubpedia;
  if (threads) payload.threads = threads;
  if (videos) payload.videos = videos;
  return payload;
}

type Status = "idle" | "loading" | "failed";

function readHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return normalizeHistoryEntries(parsed);
  } catch {
    return [];
  }
}

function normalizeHistoryEntries(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of entries) {
    if (typeof value !== "string") continue;
    const entry = value.trim().slice(0, 100);
    const key = normalizeSearchValue(entry).slice(0, 100);
    if (!entry || !key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(entry);
    if (normalized.length >= HISTORY_LIMIT) break;
  }
  return normalized;
}

function writeHistory(entries: string[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(normalizeHistoryEntries(entries)));
  } catch {
    /* 覚えられなくても検索はできる。 */
  }
}

type SavedSearch = SavedHubSearch;

const LANGUAGE_LABELS = {
  ja: { ja: "日本語", en: "Japanese" }, en: { ja: "英語", en: "English" },
  ko: { ja: "韓国語", en: "Korean" }, "zh-CN": { ja: "中国語", en: "Chinese" },
  es: { ja: "スペイン語", en: "Spanish" }, fr: { ja: "フランス語", en: "French" },
  de: { ja: "ドイツ語", en: "German" }, pt: { ja: "ポルトガル語", en: "Portuguese" },
  ar: { ja: "アラビア語", en: "Arabic" }, hi: { ja: "ヒンディー語", en: "Hindi" },
  other: { ja: "その他", en: "Other" },
};

/* 結果の種類で絞っているとき、その種類を受け持たない札は「すべて」へ戻す。 */
function groupForFilters(group: SearchGroup, filters: HubSearchFilters): SearchGroup {
  if (!filters.type || group === "all") return group;
  const owns = group === "images" ? filters.type === "images" : TAB_SOURCES[group].includes(filters.type);
  return owns ? group : "all";
}

function filterErrorMessage(japanese: boolean, reason?: string): string {
  if (japanese) {
    if (reason === "date_order") return "開始日は終了日以前にしてください。";
    if (reason === "price") return "上限価格の形式または小数桁が正しくありません。";
    if (reason === "currency") return "通貨を選び直してください。";
    if (reason === "language") return "言語を選び直してください。";
    if (reason === "type") return "結果の種類を選び直してください。";
    if (reason === "region" || reason === "category") return "地域・カテゴリは改行なしの80文字以内で入力してください。";
    return "絞り込み条件を確認してください。";
  }
  if (reason === "date_order") return "The start date must be on or before the end date.";
  if (reason === "price") return "Check the maximum price format and decimal places.";
  if (reason === "currency") return "Choose a supported currency.";
  if (reason === "language") return "Choose a supported language.";
  if (reason === "type") return "Choose a supported result type.";
  if (reason === "region" || reason === "category") return "Use up to 80 characters without line breaks for region and category.";
  return "Check the filter conditions.";
}

function formatFilterSummary(filters: HubSearchFilters, japanese: boolean): string {
  const parts: string[] = [];
  if (filters.from) parts.push(japanese ? `開始 ${filters.from}` : `From ${filters.from}`);
  if (filters.to) parts.push(japanese ? `終了 ${filters.to}` : `To ${filters.to}`);
  if (filters.maxPrice) parts.push(`${filters.maxPrice} ${filters.currency}`);
  if (filters.type) parts.push(KIND_LABEL[filters.type][japanese ? "ja" : "en"]);
  if (filters.language) parts.push(LANGUAGE_LABELS[filters.language][japanese ? "ja" : "en"]);
  if (filters.region) parts.push(`${japanese ? "地域" : "Region"}: ${filters.region}`);
  if (filters.category) parts.push(`${japanese ? "カテゴリ" : "Category"}: ${filters.category}`);
  return parts.join(" · ");
}

function formatSavedSearchLabel(saved: SavedSearch, japanese: boolean): string {
  const parts = saved.query ? [saved.query] : [];
  if (saved.label && normalizeSearchValue(saved.label) !== normalizeSearchValue(saved.query)) parts.unshift(saved.label);
  const savedTab = GROUPS.find((item) => item.id === saved.group);
  if (savedTab && savedTab.id !== "all") parts.push(japanese ? savedTab.ja : savedTab.en);
  const filterSummary = formatFilterSummary(saved.filters, japanese);
  if (filterSummary) parts.push(filterSummary);
  return parts.join(" · ");
}

function readSavedSearches(): SavedSearch[] {
  try {
    return parseSavedHubSearches(window.localStorage.getItem(SAVED_SEARCHES_KEY));
  } catch {
    return [];
  }
}

function writeSavedSearches(entries: SavedSearch[]): boolean {
  try {
    window.localStorage.setItem(SAVED_SEARCHES_KEY, serializeSavedHubSearches(entries));
    return true;
  } catch {
    return false;
  }
}

function currentSearchLocation(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function clearReturnResults(): void {
  try {
    window.sessionStorage.removeItem(RETURN_RESULTS_KEY);
  } catch {
    /* A blocked session store must not prevent ordinary search navigation. */
  }
}

function readReturnResults(location: string): ReturnResultsState | null {
  try {
    const raw = window.sessionStorage.getItem(RETURN_RESULTS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReturnResultsState>;
    if (
      value.version !== 1
      || value.location !== location
      || typeof value.targetHref !== "string"
      || value.targetHref.length > 2048
      || !value.targetHref.startsWith("/")
      || typeof value.visibleCount !== "number"
      || !Number.isInteger(value.visibleCount)
      || value.visibleCount < 1
      || value.visibleCount > RETURN_RESULTS_MAX_COUNT
      || typeof value.expiresAt !== "number"
      || value.expiresAt <= Date.now()
    ) {
      window.sessionStorage.removeItem(RETURN_RESULTS_KEY);
      return null;
    }
    return value as ReturnResultsState;
  } catch {
    clearReturnResults();
    return null;
  }
}

export function V2Search({
  initialQuery,
  initialGroup,
  initialOrder = "recommended",
  initialResults,
  japanese,
  initialFilters,
  initialFilterError = false,
  viewerId = "",
}: {
  initialQuery: string;
  initialGroup: SearchGroup;
  initialOrder?: SearchOrder;
  initialResults: SearchPayload | null;
  japanese: boolean;
  initialFilters?: HubSearchFilters;
  initialFilterError?: boolean;
  /* 投稿の札とフォローの押し手に要る。未ログインは空。 */
  viewerId?: string;
}) {
  const normalizedInitialOrder: SearchOrder = initialOrder === "kind" ? "kind" : "recommended";
  const parsedInitialFilters = initialFilters === undefined
    ? { ok: true as const, filters: EMPTY_HUB_SEARCH_FILTERS }
    : parseHubSearchFilters(initialFilters);
  const normalizedInitialFilters = parsedInitialFilters.ok ? parsedInitialFilters.filters : EMPTY_HUB_SEARCH_FILTERS;
  const normalizedInitialFiltersKey = hubSearchFiltersKey(normalizedInitialFilters);
  const hasInitialFilterError = initialFilterError || !parsedInitialFilters.ok;
  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [group, setGroup] = useState<SearchGroup>(() => groupForFilters(initialGroup, normalizedInitialFilters));
  const [order, setOrder] = useState<SearchOrder>(normalizedInitialOrder);
  const [filters, setFilters] = useState<HubSearchFilters>(normalizedInitialFilters);
  const [draftFilters, setDraftFilters] = useState<HubSearchFilters>(normalizedInitialFilters);
  const [filterError, setFilterError] = useState<string | null>(() => (
    hasInitialFilterError ? filterErrorMessage(japanese) : null
  ));
  const [filtersOpen, setFiltersOpen] = useState(hasInitialFilterError || hasHubSearchFilters(normalizedInitialFilters));
  const initialResultsPayload = hasInitialFilterError || !initialResults
    ? null
    : parseSearchPayload(initialResults, initialQuery);
  const initialServerCursor = initialResultsPayload?.nextCursor ?? null;
  const initialServerHasMore = Boolean(initialResultsPayload?.hasMore && initialResultsPayload?.nextCursor);
  const [results, setResults] = useState<SearchPayload | null>(initialResultsPayload);
  const [status, setStatus] = useState<Status>(
    !hasInitialFilterError && (initialQuery || hasHubSearchFilters(normalizedInitialFilters)) && initialResults && !initialResultsPayload ? "failed" : "idle",
  );
  const [history, setHistory] = useState<string[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [legacySearches, setLegacySearches] = useState<LegacyHubSearchCandidate[]>([]);
  const [savedSearchError, setSavedSearchError] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [selectedImage, setSelectedImage] = useState<SearchImageTile | null>(null);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  const [visibleResultLimit, setVisibleResultLimit] = useState(SEARCH_RESULT_PAGE_SIZE);
  const [serverCursor, setServerCursor] = useState<string | null>(initialServerCursor);
  const [serverHasMore, setServerHasMore] = useState(initialServerHasMore);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverCursorError, setServerCursorError] = useState(false);
  /* 札ごとの続き。キーが無い＝まだ取っていない、null＝出し切った。 */
  const [moreCursors, setMoreCursors] = useState<Record<string, string | null>>({});
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [returnResultsGeneration, setReturnResultsGeneration] = useState(0);
  const inFlight = useRef<AbortController | null>(null);
  const serverLoadInFlight = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);
  const imeKeyHeldRef = useRef(false);
  const imageCloseRef = useRef<HTMLButtonElement | null>(null);
  const imageOpenerRef = useRef<HTMLButtonElement | null>(null);
  const resultLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const previewWasOpenRef = useRef(false);
  const previewPointerStartRef = useRef<{ x: number; y: number; pointerId: number | null } | null>(null);
  const cursorScopeRef = useRef<string | null>(null);
  const visibleResultLimitRef = useRef(visibleResultLimit);
  visibleResultLimitRef.current = visibleResultLimit;
  const returnResultsRef = useRef<ReturnResultsState | null>(null);
  const returnResultsRequestCountRef = useRef(0);
  const returnResultsAutoPausedRef = useRef(false);
  const queryRef = useRef(query);
  queryRef.current = query;
  const groupRef = useRef(group);
  groupRef.current = group;
  const orderRef = useRef(order);
  orderRef.current = order;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => () => {
    inFlight.current?.abort();
    serverLoadInFlight.current?.abort();
    inFlight.current = null;
    serverLoadInFlight.current = null;
  }, []);

  const markResultNavigation = useCallback((targetHref?: string) => {
    try {
      const location = currentSearchLocation();
      window.sessionStorage.setItem(RETURN_FOCUS_KEY, location);
      const visibleCount = Math.min(visibleResultLimitRef.current, RETURN_RESULTS_MAX_COUNT);
      if (targetHref && visibleCount > SEARCH_RESULT_PAGE_SIZE) {
        window.sessionStorage.setItem(RETURN_RESULTS_KEY, JSON.stringify({
          version: 1,
          location,
          targetHref,
          visibleCount,
          expiresAt: Date.now() + RETURN_RESULTS_TTL_MS,
        } satisfies ReturnResultsState));
      } else {
        returnResultsRef.current = null;
        clearReturnResults();
      }
    } catch {
      /* セッション保存が使えなくても、リンク先への移動は続ける。 */
    }
  }, []);

  const restoreReturnResults = useCallback(() => {
    const pending = readReturnResults(currentSearchLocation());
    returnResultsRef.current = pending;
    returnResultsRequestCountRef.current = 0;
    returnResultsAutoPausedRef.current = false;
    if (pending) setReturnResultsGeneration((generation) => generation + 1);
  }, []);

  const restoreResultFocus = useCallback(() => {
    let shouldRestore = false;
    try {
      const current = `${window.location.pathname}${window.location.search}`;
      shouldRestore = window.sessionStorage.getItem(RETURN_FOCUS_KEY) === current;
    } catch {
      return;
    }
    if (!shouldRestore) return;

    // A back navigation can restore the document before React has attached the
    // input ref. Retry briefly so the marker is not consumed by an empty RAF.
    let attempts = 0;
    const focusWhenReady = () => {
      try {
        if (window.sessionStorage.getItem(RETURN_FOCUS_KEY) !== currentSearchLocation()) return;
      } catch {
        return;
      }
      const input = inputRef.current ?? document.querySelector<HTMLInputElement>('input[name="q"]');
      if (input) {
        input.focus();
        try {
          window.sessionStorage.removeItem(RETURN_FOCUS_KEY);
        } catch {
          /* セッション保存が使えなくても、フォーカス復元は済んでいる。 */
        }
        return;
      }
      attempts += 1;
      if (attempts < 10) window.requestAnimationFrame(focusWhenReady);
    };
    window.requestAnimationFrame(focusWhenReady);
  }, []);

  /*
   * 履歴は「探した語」の記録。サーバーで描いた初回の語も探したことに変わりは
   * ないので、ここで入れる。入れないと、共有されたURLから来た人の最初の検索が
   * 履歴に残らない。
   */
  useEffect(() => {
    const stored = readHistory();
    setSavedSearches(readSavedSearches());
    try {
      setLegacySearches(readLegacySurfaceSearches(window.localStorage.getItem(SAVED_SURFACE_QUERY_STORAGE_KEY)));
    } catch {
      setLegacySearches([]);
    }
    if (initialQuery) {
      const initialKey = normalizeSearchValue(initialQuery);
      const next = [initialQuery, ...stored.filter((entry) => normalizeSearchValue(entry) !== initialKey)].slice(0, HISTORY_LIMIT);
      writeHistory(next);
      setHistory(next);
    } else {
      setHistory(stored);
    }
  }, [initialQuery]);

  /*
   * URL は状態の写し。ここが崩れると戻る・進む・共有・ブックマークが壊れる。
   * 既存も pushState / replaceState / popstate の三点で往復させていた。
   */
  const syncUrl = useCallback((
    nextQuery: string,
    nextGroup: SearchGroup,
    nextOrder: SearchOrder,
    nextFilters: HubSearchFilters,
    push: boolean,
  ) => {
    const url = new URL(window.location.href);
    if (nextQuery) url.searchParams.set("q", nextQuery);
    else url.searchParams.delete("q");
    if (nextGroup !== "all") url.searchParams.set("group", nextGroup);
    else url.searchParams.delete("group");
    if (nextOrder !== "recommended") url.searchParams.set("order", nextOrder);
    else url.searchParams.delete("order");
    appendHubSearchFilters(url.searchParams, nextFilters);
    const target = `${url.pathname}${url.search}`;
    if (push) window.history.pushState(null, "", target);
    else window.history.replaceState(null, "", target);
  }, []);

  const run = useCallback(async (
    raw: string,
    options?: { push?: boolean; resetResults?: boolean; filters?: HubSearchFilters },
  ) => {
    setSuggestionsDismissed(true);
    setActiveSuggestion(-1);
    /*
     * URL と履歴には打った語をそのまま残す。正規化（NFKC・小文字）は探すときだけ。
     * 正規化した語をURLへ書くと、札を押した瞬間に Kamma が kamma へ変わる。
     * 打った覚えのない語がURLに出るのは、共有したときに戸惑う。
     */
    const typed = raw.trim().slice(0, 100);
    const normalized = normalizeSearchValue(typed).slice(0, 100);
    const queryChanged = normalizeSearchValue(queryRef.current) !== normalized;
    const requestFilters = options?.filters ?? filtersRef.current;
    const nextGroup = groupForFilters(groupRef.current, requestFilters);
    if (groupRef.current !== nextGroup) {
      groupRef.current = nextGroup;
      setGroup(nextGroup);
    }
    const filtersChanged = hubSearchFiltersKey(filtersRef.current) !== hubSearchFiltersKey(requestFilters);
    if (options?.filters) {
      filtersRef.current = requestFilters;
      setFilters(requestFilters);
      setDraftFilters(requestFilters);
      setFilterError(null);
    }
    setQuery(typed);
    inFlight.current?.abort();
    serverLoadInFlight.current?.abort();
    serverLoadInFlight.current = null;
    setServerLoading(false);
    setServerCursor(null);
    setServerHasMore(false);
    setServerCursorError(false);
    // A new query invalidates the old media context immediately. Do not leave
    // a preview from the previous search visible while its replacement loads.
    setSelectedImage(null);
    setPreviewImageFailed(false);
    imageOpenerRef.current = null;
    if (queryChanged || filtersChanged || options?.resetResults) {
      // Do not let results or failed-image state from another query remain
      // under a new query or a new server-signed order while its replacement
      // request is loading.
      setResults(null);
      setFailedImageIds(new Set());
    }

    if (!normalized && !hasHubSearchFilters(requestFilters)) {
      /* 語が無ければ札も意味を失う。?group= を残さない。 */
      groupRef.current = "all";
      setGroup("all");
      orderRef.current = "recommended";
      setOrder("recommended");
      filtersRef.current = EMPTY_HUB_SEARCH_FILTERS;
      setFilters(EMPTY_HUB_SEARCH_FILTERS);
      setDraftFilters(EMPTY_HUB_SEARCH_FILTERS);
      inFlight.current = null;
      syncUrl("", "all", "recommended", EMPTY_HUB_SEARCH_FILTERS, options?.push ?? true);
      setResults(null);
      setStatus("idle");
      return;
    }

    syncUrl(typed, groupRef.current, orderRef.current, requestFilters, options?.push ?? true);
    if (normalized) {
      const next = [typed, ...readHistory().filter((entry) => normalizeSearchValue(entry) !== normalized)].slice(0, HISTORY_LIMIT);
      writeHistory(next);
      setHistory(next);
    }

    const controller = new AbortController();
    inFlight.current = controller;
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    setStatus("loading");
    try {
      const params = new URLSearchParams({ cursorMode: "1", order: orderRef.current });
      if (normalized) params.set("q", normalized);
      appendHubSearchFilters(params, requestFilters);
      const response = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const payload = parseSearchPayload(await response.json(), normalized);
      if (!payload) throw new Error("invalid search response");
      if (inFlight.current !== controller) return;
      setResults(payload);
      setServerCursor(payload.nextCursor ?? null);
      setServerHasMore(Boolean(payload.hasMore && payload.nextCursor));
      setServerCursorError(false);
      setStatus("idle");
    } catch {
      /* 新しい検索に追い越されて止められた分は、失敗として出さない。 */
      if (inFlight.current !== controller) return;
      setResults(null);
      setStatus("failed");
    } finally {
      window.clearTimeout(timer);
    }
  }, [syncUrl]);

  useEffect(() => {
    const onPop = () => {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("q") ?? "";
      const nextGroup = normalizeGroup(url.searchParams.get("group"));
      const nextOrder: SearchOrder = url.searchParams.get("order") === "kind" ? "kind" : "recommended";
      const parsedFilters = parseHubSearchFilters(url.searchParams);
      if (!parsedFilters.ok) {
        inFlight.current?.abort();
        serverLoadInFlight.current?.abort();
        inFlight.current = null;
        serverLoadInFlight.current = null;
        setServerLoading(false);
        setServerCursor(null);
        setServerHasMore(false);
        setServerCursorError(false);
        setSelectedImage(null);
        setPreviewImageFailed(false);
        imageOpenerRef.current = null;
        setResults(null);
        setStatus("idle");
        filtersRef.current = EMPTY_HUB_SEARCH_FILTERS;
        setFilters(EMPTY_HUB_SEARCH_FILTERS);
        setDraftFilters(EMPTY_HUB_SEARCH_FILTERS);
        setFilterError(filterErrorMessage(japanese, parsedFilters.reason));
        queryRef.current = q;
        setQuery(q);
        groupRef.current = nextGroup;
        setGroup(nextGroup);
        orderRef.current = nextOrder;
        setOrder(nextOrder);
        setDraft(q);
        setFiltersOpen(true);
        return;
      }
      const orderChanged = orderRef.current !== nextOrder;
      const filtersChanged = hubSearchFiltersKey(filtersRef.current) !== hubSearchFiltersKey(parsedFilters.filters);
      setDraft(q);
      setDraftFilters(parsedFilters.filters);
      setFiltersOpen(hasHubSearchFilters(parsedFilters.filters));
      setFilterError(null);
      // Returning from a result should put the user back at the search control.
      // The browser otherwise leaves focus on the now-hidden result link.
      window.requestAnimationFrame(() => inputRef.current?.focus());
      /* Keep the ref in step before run() reads it; React commits setState later. */
      groupRef.current = nextGroup;
      setGroup(nextGroup);
      orderRef.current = nextOrder;
      setOrder(nextOrder);
      void run(q, { push: false, resetResults: orderChanged || filtersChanged, filters: parsedFilters.filters });
    };
    const reconcileLocation = () => {
      const url = new URL(window.location.href);
      if (url.pathname !== "/v2/search") return false;
      const parsedFilters = parseHubSearchFilters(url.searchParams);
      const nextGroup = normalizeGroup(url.searchParams.get("group"));
      const nextOrder = url.searchParams.get("order") === "kind" ? "kind" : "recommended";
      if (!parsedFilters.ok
        || normalizeSearchValue(url.searchParams.get("q") ?? "") !== normalizeSearchValue(queryRef.current)
        || nextGroup !== groupRef.current
        || nextOrder !== orderRef.current
        || hubSearchFiltersKey(parsedFilters.filters) !== hubSearchFiltersKey(filtersRef.current)) {
        onPop();
        return true;
      }
      return false;
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("pageshow", reconcileLocation);
    // Next may restore cached SSR props after popstate already fired. Read the
    // address bar first so a stale SSR retry cannot overwrite the returned URL.
    if (!reconcileLocation() && !hasInitialFilterError && !initialResults
      && (normalizeSearchValue(initialQuery) || hasHubSearchFilters(normalizedInitialFilters))) {
      void run(initialQuery, { push: false });
    }
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pageshow", reconcileLocation);
    };
  }, [hasInitialFilterError, initialQuery, initialResults, normalizedInitialFiltersKey, japanese, run]);

  /* 結果から戻るとき、bfcache復元ではpopstateが発火しないブラウザがある。 */
  useEffect(() => {
    restoreResultFocus();
    restoreReturnResults();
    const onPageShow = () => {
      restoreResultFocus();
      restoreReturnResults();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [restoreResultFocus, restoreReturnResults]);

  const entities = useMemo(() => results?.coreEntities ?? [], [results]);

  /* 札に出す補足。coreEntities は題と行き先だけなので、応答の本体の配列から引く。 */
  const detail = useMemo(() => ({
    persons: new Map((results?.profiles ?? []).map((person) => [person.id, person])),
    hubpedia: new Map((results?.hubpedia ?? []).map((article) => [article.slug, article])),
    threads: new Map((results?.threads ?? []).map((thread) => [thread.id, thread])),
    videos: new Map((results?.videos ?? []).map((video) => [video.id, video])),
    posts: new Map((results?.extras?.posts ?? []).map((post) => [post.id, post])),
    articles: new Map((results?.extras?.articles ?? []).map((article) => [article.id, article])),
    music: new Map((results?.extras?.music ?? []).map((work) => [work.id, work])),
    extraThreads: new Map((results?.extras?.threads ?? []).map((thread) => [thread.id, thread])),
    following: new Set(results?.extras?.followingProfileIds ?? []),
  }), [results]);

  /*
   * 語そのものを1つのタグとして見る入口は、タグの札の先頭に必ず置く（登録の有無によらず
   * /v2/tag/<語> は全種類を並べる）。登録済みのタグがあれば、その後ろに並べる。
   */
  const tagCards = useMemo<SearchTagCard[]>(() => {
    if (!results || !query.trim()) return [];
    const typed = query.trim().replace(/^#+/, "").trim().slice(0, 60);
    const typedKey = normalizeSearchValue(typed);
    const registered = results.extras?.tags ?? [];
    const typedRegistered = registered.find((tag) => normalizeSearchValue(tag.key) === typedKey);
    return [
      typedRegistered ?? { name: typed, key: typedKey, useCount: 0 },
      ...registered.filter((tag) => tag !== typedRegistered),
    ].filter((tag) => tag.name);
  }, [query, results]);

  /* 画面に並べる1件。coreEntities と extras（記事・音楽・タグ・タグだけで当たった投稿とスレッド）を1つにする。 */
  const items = useMemo<SearchItem[]>(() => {
    const core: SearchItem[] = entities.map((entity) => ({
      sourceGroup: entity.sourceGroup,
      id: entity.ref.id,
      href: entity.href,
      title: entity.title,
      score: (entity as { score?: number }).score,
    }));
    /* タグや本文で当たった記事・投稿が、長い Hubpedia の列の後ろに埋もれないよう、上位 3 件の直後に差し込む。 */
    const list: SearchItem[] = core.slice(0, 3);
    const extras = results?.extras;
    if (extras) {
      for (const id of extras.taggedPostIds) {
        const post = detail.posts.get(id);
        if (post) list.push({ sourceGroup: "posts", id, href: `/v2/posts/${encodeURIComponent(id)}`, title: post.body.slice(0, 80) });
      }
      for (const article of extras.articles) list.push({ sourceGroup: "articles", id: article.id, href: article.href, title: article.title });
      for (const work of extras.music) list.push({ sourceGroup: "music", id: work.id, href: work.href, title: work.title });
      for (const card of extras.kinds ?? []) list.push({ sourceGroup: card.kind, id: card.id, href: card.href, title: card.title, score: card.score });
      for (const thread of extras.threads) list.push({ sourceGroup: "threads", id: thread.id, href: thread.href, title: thread.title });
    }
    list.push(...core.slice(3));
    for (const tag of tagCards) list.push({ sourceGroup: "tags", id: tag.key, href: `/v2/tag/${encodeURIComponent(tag.name)}`, title: `#${tag.name}` });
    const seen = new Set<string>();
    return list.filter((item) => {
      const key = `${item.sourceGroup}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [detail.posts, entities, results, tagCards]);

  const ordered = useMemo(() => {
    /* タグは自分の札だけ。「すべて」には混ぜない。 */
    const scoped = group === "all"
      ? items.filter((item) => item.sourceGroup !== "tags")
      : items.filter((item) => TAB_SOURCES[group].includes(item.sourceGroup));
    return order === "kind" ? orderByKind(scoped) : orderByRecommended(scoped, query, group);
  }, [group, items, order, query]);
  const shown = ordered.slice(0, visibleResultLimit);
  /* 続きのカーソルが効くのは、coreEntities の種類を受け持つ札だけ。 */
  const moreOnServer = serverHasMore && TABS_WITH_CURSOR.has(group);
  const hasMoreResults = shown.length < ordered.length || moreOnServer;
  const filterScopeKey = hubSearchFiltersKey(filters);
  const hasActiveFilters = hasHubSearchFilters(filters);

  useEffect(() => {
    const pending = returnResultsRef.current;
    if (!pending) {
      returnResultsAutoPausedRef.current = false;
      return;
    }
    if (pending.location === currentSearchLocation()) return;
    returnResultsRef.current = null;
    returnResultsAutoPausedRef.current = false;
    clearReturnResults();
  }, [filterScopeKey, group, order, query]);

  useEffect(() => {
    setVisibleResultLimit(SEARCH_RESULT_PAGE_SIZE);
  }, [filterScopeKey, group, order, query]);

  useEffect(() => {
    /* Query, order and server filters are signed into the cursor; group is client-only. */
    const scope = `${order}\u0000${query}\u0000${filterScopeKey}`;
    if (cursorScopeRef.current === null) {
      cursorScopeRef.current = scope;
      return;
    }
    if (cursorScopeRef.current === scope) return;
    cursorScopeRef.current = scope;
    setServerCursor(null);
    setServerHasMore(false);
    setServerCursorError(false);
    setMoreCursors({});
    setMoreError(false);
  }, [filterScopeKey, group, order, query]);

  const loadMoreResults = useCallback(async () => {
    const scope = `${order}\u0000${query}\u0000${filterScopeKey}`;
    if (cursorScopeRef.current !== scope) return;
    if (shown.length < ordered.length) {
      setVisibleResultLimit((current) => Math.min(current + SEARCH_RESULT_PAGE_SIZE, ordered.length));
      return;
    }
    if (!TABS_WITH_CURSOR.has(group)) return;
    if (!serverCursor || serverLoading || serverLoadInFlight.current || (!query && !hasActiveFilters)) return;
    const controller = new AbortController();
    serverLoadInFlight.current = controller;
    setServerLoading(true);
    setServerCursorError(false);
    try {
      const normalized = normalizeSearchValue(query).slice(0, 100);
      const params = new URLSearchParams({ cursorMode: "1", order, cursor: serverCursor });
      if (normalized) params.set("q", normalized);
      appendHubSearchFilters(params, filters);
      const response = await fetch(
        `/api/search?${params.toString()}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(String(response.status));
      const payload = parseSearchPayload(await response.json(), normalized);
      if (!payload) throw new Error("invalid search response");
      if (payload.nextCursor === serverCursor || (payload.hasMore && (!payload.nextCursor || !payload.coreEntities.length))) {
        throw new Error("search cursor did not advance");
      }
      if (payload.hasMore) {
        const currentKeys = new Set(entities.map((entity) => `${entity.sourceGroup}:${entity.ref.id}`));
        const addsEntity = payload.coreEntities.some((entity) => !currentKeys.has(`${entity.sourceGroup}:${entity.ref.id}`));
        if (!addsEntity) throw new Error("search continuation made no progress");
      }
      if (serverLoadInFlight.current !== controller || cursorScopeRef.current !== scope) return;
      setResults((current) => {
        if (!current) return payload;
        const merged = new Map<string, HubCoreSearchEntity>();
        for (const entity of [...current.coreEntities, ...payload.coreEntities]) {
          merged.set(`${entity.sourceGroup}:${entity.ref.id}`, entity);
        }
        return { ...current, ...payload, coreEntities: [...merged.values()] };
      });
      setVisibleResultLimit((current) => Math.max(
        current,
        Math.min(current + SEARCH_RESULT_PAGE_SIZE, ordered.length + payload.coreEntities.length),
      ));
      setServerCursor(payload.nextCursor ?? null);
      setServerHasMore(Boolean(payload.hasMore && payload.nextCursor));
    } catch {
      if (serverLoadInFlight.current !== controller || cursorScopeRef.current !== scope) return;
      /* Invalid or unavailable cursors fail closed; already visible results remain. */
      setServerCursor(null);
      setServerHasMore(false);
      setServerCursorError(true);
    } finally {
      if (serverLoadInFlight.current === controller) {
        serverLoadInFlight.current = null;
        setServerLoading(false);
      }
    }
  }, [cursorScopeRef, entities, filterScopeKey, filters, group, hasActiveFilters, order, ordered.length, query, serverCursor, serverLoading, shown.length]);

  const moreKind = MORE_KIND_BY_GROUP[group];
  const kindItemCount = moreKind ? ordered.length : 0;
  const canLoadMoreKind = Boolean(
    moreKind && results && query.trim() && !hasActiveFilters && !hasMoreResults
    && kindItemCount >= moreKind.firstPage && moreCursors[moreKind.kind] !== null,
  );
  const loadMoreKind = useCallback(async () => {
    if (!moreKind || moreLoading) return;
    const scope = `${order} ${query} ${filterScopeKey}`;
    const cursor = moreCursors[moreKind.kind];
    setMoreLoading(true);
    setMoreError(false);
    try {
      const normalized = normalizeSearchValue(query).slice(0, 100);
      const params = new URLSearchParams({ q: normalized, kind: moreKind.kind });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/search/more?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const payload = parseSearchPayload(await response.json(), normalized);
      if (!payload) throw new Error("invalid search response");
      if (cursorScopeRef.current !== scope) return;
      setResults((current) => {
        if (!current) return payload;
        const merged = new Map<string, HubCoreSearchEntity>();
        for (const entity of [...current.coreEntities, ...payload.coreEntities]) merged.set(`${entity.sourceGroup}:${entity.ref.id}`, entity);
        const byKey = <T,>(list: T[] | undefined, extra: T[] | undefined, key: (item: T) => string) => {
          const map = new Map<string, T>();
          for (const item of [...(list ?? []), ...(extra ?? [])]) map.set(key(item), item);
          return [...map.values()];
        };
        const extras = current.extras
          ? {
              ...current.extras,
              posts: byKey(current.extras.posts, payload.extras?.posts, (post) => post.id),
              articles: byKey(current.extras.articles, payload.extras?.articles, (article) => article.id),
              kinds: byKey(current.extras.kinds, payload.kinds, (card) => `${card.kind}:${card.id}`),
            }
          : payload.extras;
        return {
          ...current,
          coreEntities: [...merged.values()],
          profiles: byKey(current.profiles, payload.profiles, (person) => person.id),
          hubpedia: byKey(current.hubpedia, payload.hubpedia, (article) => article.slug),
          threads: byKey(current.threads, payload.threads, (thread) => thread.id),
          ...(extras ? { extras } : {}),
        };
      });
      setVisibleResultLimit((current) => current + SEARCH_MORE_PAGE_SIZE);
      setMoreCursors((current) => ({ ...current, [moreKind.kind]: payload.nextCursor ?? null }));
    } catch {
      setMoreError(true);
    } finally {
      setMoreLoading(false);
    }
  }, [cursorScopeRef, filterScopeKey, moreCursors, moreKind, moreLoading, order, query]);

  useEffect(() => {
    if (!hasMoreResults || typeof IntersectionObserver === "undefined") return;
    const sentinel = resultLoadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (returnResultsRef.current || returnResultsAutoPausedRef.current) return;
      if (entries.some((entry) => entry.isIntersecting)) loadMoreResults();
    }, { rootMargin: "240px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreResults, loadMoreResults]);

  useEffect(() => {
    const pending = returnResultsRef.current;
    if (!pending) return;
    if (pending.location !== currentSearchLocation()) {
      returnResultsRef.current = null;
      returnResultsAutoPausedRef.current = false;
      clearReturnResults();
      return;
    }
    const target = Array.from(document.querySelectorAll<HTMLAnchorElement>(".v2-search__results a[href]"))
      .find((link) => link.getAttribute("href") === pending.targetHref);
    if (target?.isConnected) {
      try {
        window.sessionStorage.removeItem(RETURN_FOCUS_KEY);
      } catch {
        /* The result row is still a valid return target without storage. */
      }
      target.focus();
      returnResultsRef.current = null;
      clearReturnResults();
      return;
    }
    if (shown.length >= pending.visibleCount || !hasMoreResults || serverCursorError) {
      returnResultsRef.current = null;
      clearReturnResults();
      return;
    }
    if (!results || status !== "idle" || serverLoading) return;
    if (shown.length >= ordered.length) {
      if (returnResultsRequestCountRef.current >= RETURN_RESULTS_MAX_REQUESTS) {
        returnResultsRef.current = null;
        returnResultsAutoPausedRef.current = true;
        clearReturnResults();
        return;
      }
      returnResultsRequestCountRef.current += 1;
    }
    void loadMoreResults();
  }, [hasMoreResults, loadMoreResults, ordered.length, results, returnResultsGeneration, serverCursorError, serverLoading, shown.length, status]);

  const selectGroup = (next: SearchGroup) => {
    groupRef.current = next;
    serverLoadInFlight.current?.abort();
    serverLoadInFlight.current = null;
    setServerLoading(false);
    setServerCursorError(false);
    setGroup(next);
    if (next !== "all" && next !== "images" && selectedImage) {
      // A tab without the image grid cannot display the selected tile. Close before the
      // new tab paints so the old preview never flashes over the new results.
      setSelectedImage(null);
      imageOpenerRef.current = null;
    }
    syncUrl(query, next, orderRef.current, filtersRef.current, false);
  };

  const selectOrder = (next: SearchOrder) => {
    orderRef.current = next;
    serverLoadInFlight.current?.abort();
    serverLoadInFlight.current = null;
    setServerLoading(false);
    setServerCursor(null);
    setServerHasMore(false);
    setServerCursorError(false);
    setOrder(next);
    if (queryRef.current || hasHubSearchFilters(filtersRef.current)) {
      /* The cursor is bound to order, so restart the same query for a fresh cursor. */
      void run(queryRef.current, { push: false, resetResults: true });
    } else {
      syncUrl(queryRef.current, groupRef.current, next, filtersRef.current, false);
    }
  };

  const clearHistory = () => {
    writeHistory([]);
    setHistory([]);
  };

  const hasActiveSearch = Boolean(query || hasActiveFilters);
  const currentSavedSearch = hasActiveSearch
    ? savedSearches.some((saved) => savedSearchKey(saved) === savedSearchKey({ query: query.trim(), group, filters }))
    : false;

  const toggleSavedSearch = () => {
    const nextSearch = { query: query.trim().slice(0, 100), group, filters };
    if ((!nextSearch.query || !normalizeSearchValue(nextSearch.query)) && !hasHubSearchFilters(nextSearch.filters)) return;
    const currentKey = savedSearchKey(nextSearch);
    const next = currentSavedSearch
      ? savedSearches.filter((saved) => savedSearchKey(saved) !== currentKey)
      : [nextSearch, ...savedSearches.filter((saved) => savedSearchKey(saved) !== currentKey)].slice(0, SAVED_SEARCHES_LIMIT);
    if (!writeSavedSearches(next)) {
      setSavedSearchError(true);
      return;
    }
    setSavedSearchError(false);
    setSavedSearches(next);
  };

  const removeSavedSearch = (saved: SavedSearch) => {
    const next = savedSearches.filter((candidate) => savedSearchKey(candidate) !== savedSearchKey(saved));
    if (!writeSavedSearches(next)) {
      setSavedSearchError(true);
      return;
    }
    setSavedSearchError(false);
    setSavedSearches(next);
  };

  const importLegacySearch = (candidate: { query: string; label: string }): "imported" | "duplicate" | "full" | "invalid" | "storage_error" => {
    // Re-read at the explicit action so another tab's saved items are preserved.
    let current: SavedSearch[];
    try {
      current = parseSavedHubSearches(window.localStorage.getItem(SAVED_SEARCHES_KEY));
    } catch {
      return "storage_error";
    }
    const plan = planLegacyHubSearchImport(current, candidate);
    if (plan.status !== "imported") {
      setSavedSearches(current);
      return plan.status;
    }
    if (!writeSavedSearches(plan.searches)) return "storage_error";
    setSavedSearchError(false);
    setSavedSearches(plan.searches);
    return "imported";
  };

  const runSavedSearch = (saved: SavedSearch) => {
    setDraft(saved.query);
    setFiltersOpen(hasHubSearchFilters(saved.filters));
    /* 旧い札（social など）で保存した検索は「すべて」で開く。 */
    const savedGroup = groupForFilters(normalizeGroup(saved.group), saved.filters);
    groupRef.current = savedGroup;
    setGroup(savedGroup);
    void run(saved.query, { filters: saved.filters });
  };

  /*
   * 画像は「メディア」と「すべて」でだけ出す。1枚ずつではなく投稿ごとに来るので、
   * 平らにしてから並べる。行き先は投稿そのもの（画像だけの画面は作らない）。
   */
  const imageTiles = useMemo<SearchImageTile[]>(() => {
    /* 「画像」札は V2ImageSearch が受け持つ (敷き詰め・無限スクロール・詳細・ボード)。ここの小さな帯は「すべて」だけ。 */
    if (group !== "all") return [];
    const seen = new Set<string>();
    return (results?.images ?? [])
      .flatMap((hit) => (hit.images ?? []).map((image) => imageTileFromHit(hit, image)))
      .filter((tile) => {
        if (seen.has(tile.key)) return false;
        seen.add(tile.key);
        return true;
      })
      .slice(0, 24);
  }, [results, group]);

  const imageAdContext = useMemo(() => ({
    pageType: "image_search",
    pageCategory: "images",
    contentTags: imageTiles.map((tile) => tile.alt || tile.caption).slice(0, 8),
    contentKeywords: [query, ...imageTiles.map((tile) => tile.alt || tile.caption)]
      .filter(Boolean)
      .slice(0, 20),
    language: japanese ? "ja" : "en",
  }), [imageTiles, japanese, query]);

  const relatedImageTiles = useMemo<SearchImageTile[]>(() => {
    if (!selectedImage) return [];
    const selectedHit = (results?.images ?? []).find((hit) => hit.id === selectedImage.postId);
    if (!selectedHit) return [];
    const candidates = (results?.images ?? [])
      .filter((hit) => hit.id !== selectedHit.id && (hit.images?.length ?? 0) > 0)
      .map((hit) => ({
        hit,
        candidate: {
          id: hit.id,
          body: hit.body,
          displayName: hit.displayName,
          handle: hit.handle ?? null,
          images: hit.images?.map((image) => ({ altText: image.altText ?? undefined })),
          score: 0,
        },
      }));
    const selectedCandidate = {
      id: selectedHit.id,
      body: selectedHit.body,
      displayName: selectedHit.displayName,
      handle: selectedHit.handle ?? null,
      images: selectedHit.images?.map((image) => ({ altText: image.altText ?? undefined })),
    };
    const ranked = rankHubImages(candidates.map(({ candidate }) => candidate), {
      interests: imageInterestTerms(selectedCandidate),
      historyIds: [],
      queryActive: true,
    });
    const hitsById = new Map(candidates.map(({ hit }) => [hit.id, hit]));
    const seen = new Set<string>();
    return ranked.flatMap((candidate) => {
      const hit = hitsById.get(candidate.id);
      const image = hit?.images?.[0];
      if (!image || seen.has(image.id)) return [];
      seen.add(image.id);
      return [imageTileFromHit(hit, image)];
    }).slice(0, 6);
  }, [results, selectedImage]);

  const selectedImageIndex = useMemo(
    () => selectedImage ? imageTiles.findIndex((tile) => tile.key === selectedImage.key) : -1,
    [imageTiles, selectedImage],
  );

  useEffect(() => {
    if (!selectedImage || selectedImageIndex >= 0) return;
    // A new search or group can remove the image that opened the dialog.
    // Do not leave stale media and a stale source-post link visible.
    setSelectedImage(null);
    imageOpenerRef.current = null;
  }, [selectedImage, selectedImageIndex]);

  const moveImagePreview = useCallback((offset: number) => {
    if (selectedImageIndex < 0) return;
    const nextIndex = selectedImageIndex + offset;
    if (nextIndex < 0 || nextIndex >= imageTiles.length) return;
    // Navigation replaces the preview media in the same render. Clear the
    // previous image's failure state before the new source is painted.
    setPreviewImageFailed(false);
    setSelectedImage(imageTiles[nextIndex]);
  }, [imageTiles, selectedImageIndex]);

  const onPreviewPointerDown = useCallback((event: ReactPointerEvent<HTMLImageElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    if (pointerId !== null && typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(pointerId);
    }
    previewPointerStartRef.current = { x: event.clientX, y: event.clientY, pointerId };
  }, []);

  const onPreviewPointerUp = useCallback((event: ReactPointerEvent<HTMLImageElement>) => {
    const start = previewPointerStartRef.current;
    previewPointerStartRef.current = null;
    if (
      start?.pointerId !== null && start?.pointerId !== undefined
      && typeof event.currentTarget.hasPointerCapture === "function"
      && event.currentTarget.hasPointerCapture(start.pointerId)
      && typeof event.currentTarget.releasePointerCapture === "function"
    ) {
      event.currentTarget.releasePointerCapture(start.pointerId);
    }
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    moveImagePreview(deltaX < 0 ? 1 : -1);
  }, [moveImagePreview]);

  const onPreviewPointerCancel = useCallback((event: ReactPointerEvent<HTMLImageElement>) => {
    const pointerId = previewPointerStartRef.current?.pointerId;
    previewPointerStartRef.current = null;
    if (
      pointerId !== null && pointerId !== undefined
      && typeof event.currentTarget.hasPointerCapture === "function"
      && event.currentTarget.hasPointerCapture(pointerId)
      && typeof event.currentTarget.releasePointerCapture === "function"
    ) {
      event.currentTarget.releasePointerCapture(pointerId);
    }
  }, []);

  const closeImagePreview = useCallback(() => {
    const opener = imageOpenerRef.current;
    setSelectedImage(null);
    opener?.focus();
    window.requestAnimationFrame(() => opener?.focus());
  }, []);

  const markImageFailed = useCallback((imageId: string) => {
    setFailedImageIds((current) => {
      if (current.has(imageId)) return current;
      const next = new Set(current);
      next.add(imageId);
      return next;
    });
  }, []);

  useEffect(() => {
    setPreviewImageFailed(false);
  }, [selectedImage?.key]);

  useEffect(() => {
    if (!selectedImage) {
      previewWasOpenRef.current = false;
      return;
    }
    if (!previewWasOpenRef.current) {
      previewWasOpenRef.current = true;
      window.requestAnimationFrame(() => imageCloseRef.current?.focus());
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeImagePreview();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveImagePreview(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveImagePreview(1);
      } else if (event.key === "Tab") {
        // Keep keyboard focus inside the modal while it is open. This also
        // makes the related-image controls reachable without leaking focus to
        // the page behind the preview.
        const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="v2-search-image-preview-title"]');
        if (!dialog) return;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeImagePreview, moveImagePreview, selectedImage]);

  const suggestionCandidates = useMemo(() => {
    const typed = normalizeSearchValue(draft.trim());
    if (!typed) return [];
    return history
      .filter((entry) => normalizeSearchValue(entry) !== typed && normalizeSearchValue(entry).includes(typed))
      .slice(0, 5);
  }, [draft, history]);
  const suggestions = suggestionsDismissed ? [] : suggestionCandidates;

  useEffect(() => {
    setActiveSuggestion(-1);
  }, [draft, history]);

  const alternatives = query ? searchAlternatives(query) : [];
  const submitSearch = useCallback((raw: string) => {
    // Suggestions can submit outside the native form event; keep validation identical.
    if (inputRef.current?.form && !inputRef.current.form.checkValidity()) return;
    const parsedFilters = parseHubSearchFilters(draftFilters);
    if (!parsedFilters.ok) {
      setFilterError(filterErrorMessage(japanese, parsedFilters.reason));
      setFiltersOpen(true);
      return;
    }
    const nextFilters = parsedFilters.filters;
    const filtersChanged = hubSearchFiltersKey(filters) !== hubSearchFiltersKey(nextFilters);
    setFilterError(null);
    setDraftFilters(nextFilters);
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    void run(raw, { filters: nextFilters, resetResults: filtersChanged });
  }, [draftFilters, filters, japanese, run]);

  const clearFilters = useCallback(() => {
    const hadActiveFilters = hasHubSearchFilters(filtersRef.current);
    const nextFilters = EMPTY_HUB_SEARCH_FILTERS;
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    setDraftFilters(nextFilters);
    setFilterError(null);
    setFiltersOpen(false);
    if (queryRef.current || hadActiveFilters) {
      void run(queryRef.current, { push: false, filters: nextFilters, resetResults: true });
    } else {
      syncUrl(queryRef.current, groupRef.current, orderRef.current, nextFilters, false);
    }
  }, [run, syncUrl]);

  /* 投稿の札は V2Post がリンクを持つ。どのリンクから出ても、戻ったときに同じ行へ戻れるよう印を付ける。 */
  const onPostCardClick = (event: ReactMouseEvent<HTMLElement>) => {
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (anchor) markResultNavigation(anchor.getAttribute("href") ?? undefined);
  };

  /* 1件を種類ごとの札にする。補足が無い（応答に載らなかった）ものは、種類の札と題の1行に戻す。 */
  const renderResult = (item: SearchItem) => {
    switch (item.sourceGroup) {
      case "posts": {
        const post = detail.posts.get(item.id);
        if (post) return <V2Post post={post} viewerId={viewerId} locale={japanese ? "ja" : "en"} />;
        break;
      }
      case "profiles": {
        const person = detail.persons.get(item.id);
        if (person) {
          return (
            <SearchPersonCard
              person={person}
              href={item.href}
              viewerId={viewerId}
              following={detail.following.has(person.id)}
              japanese={japanese}
              onNavigate={markResultNavigation}
            />
          );
        }
        break;
      }
      case "articles": {
        const article = detail.articles.get(item.id);
        if (article) return <SearchArticleResult article={article} japanese={japanese} onNavigate={markResultNavigation} />;
        break;
      }
      case "videos": {
        const video = detail.videos.get(item.id);
        if (video) return <SearchVideoResult video={video} href={item.href} japanese={japanese} onNavigate={markResultNavigation} />;
        break;
      }
      case "music": {
        const work = detail.music.get(item.id);
        if (work) return <SearchMusicResult work={work} japanese={japanese} onNavigate={markResultNavigation} />;
        break;
      }
      case "hubpedia": {
        const article = detail.hubpedia.get(item.id);
        if (article) return <SearchHubpediaResult article={article} href={item.href} onNavigate={markResultNavigation} />;
        break;
      }
      case "threads": {
        const thread = detail.extraThreads.get(item.id) ?? detail.threads.get(item.id);
        if (thread) return <SearchThreadResult thread={{ ...thread, href: item.href }} japanese={japanese} onNavigate={markResultNavigation} />;
        break;
      }
      case "tags": {
        const tag = tagCards.find((candidate) => candidate.key === item.id);
        if (tag) return <SearchTagResult tag={tag} japanese={japanese} onNavigate={markResultNavigation} />;
        break;
      }
      default:
        break;
    }
    return (
      <SearchKindResult
        kindLabel={japanese ? KIND_LABEL[item.sourceGroup]?.ja ?? item.sourceGroup : KIND_LABEL[item.sourceGroup]?.en ?? item.sourceGroup}
        title={item.title}
        href={item.href}
        onNavigate={markResultNavigation}
      />
    );
  };

  return (
    <div className="v2-search">
      <form
        className="v2-search__form"
        role="search"
        onInvalid={(event) => {
          // Open collapsed controls before native validation tries to focus them.
          event.preventDefault();
          setFiltersOpen(true);
          setFilterError(filterErrorMessage(japanese, event.target instanceof HTMLInputElement && event.target.name === "maxPrice" ? "price" : "date"));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          // The same IME Enter can reach submit after compositionend, before keyup.
          if (isComposingRef.current || imeKeyHeldRef.current) return;
          submitSearch(draft);
        }}
      >
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSuggestionsDismissed(false);
          }}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          onKeyUp={() => { imeKeyHeldRef.current = false; }}
          onBlur={() => {
            isComposingRef.current = false;
            imeKeyHeldRef.current = false;
          }}
          onKeyDown={(event) => {
            // keyCode 229 also covers IME keydown events outside compositionstart/end.
            if (isComposingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
              imeKeyHeldRef.current = true;
              return;
            }
            imeKeyHeldRef.current = false;
            if (!suggestionCandidates.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSuggestionsDismissed(false);
              setActiveSuggestion((current) => !suggestionsDismissed && current < suggestionCandidates.length - 1 ? current + 1 : 0);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSuggestionsDismissed(false);
              setActiveSuggestion((current) => !suggestionsDismissed && current > 0 ? current - 1 : suggestionCandidates.length - 1);
              return;
            }
            if (event.key === "Escape" && suggestions.length) {
              event.preventDefault();
              setActiveSuggestion(-1);
              setSuggestionsDismissed(true);
              return;
            }
            if (event.key === "Enter" && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
              event.preventDefault();
              const suggestion = suggestions[activeSuggestion];
              setDraft(suggestion);
              setActiveSuggestion(-1);
              submitSearch(suggestion);
            }
          }}
          placeholder={japanese ? "Hubを検索" : "Search Hub"}
          aria-label={japanese ? "Hubを検索" : "Search Hub"}
          aria-autocomplete="list"
          aria-controls={suggestions.length ? "v2-search-suggestions" : undefined}
          aria-expanded={suggestions.length > 0}
          aria-activedescendant={activeSuggestion >= 0 && suggestions[activeSuggestion] ? `v2-search-suggestion-${activeSuggestion}` : undefined}
          autoComplete="off"
        />
        <button type="submit" className="v2-search__submit v2-sr">{japanese ? "検索" : "Search"}</button>
        <details
          className="v2-search__filters"
          open={filtersOpen}
          onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
        >
          <summary>
            <span>{japanese ? "絞り込み" : "Filters"}</span>
            {hasHubSearchFilters(filters) ? (
              <span className="v2-search__filters-applied">
                {japanese ? " · 適用中: " : " · Applied: "}{formatFilterSummary(filters, japanese)}
              </span>
            ) : null}
          </summary>
          <div className="v2-search__filter-fields">
            <div className="v2-search__filter-field">
              <label htmlFor="v2-search-filter-type">{japanese ? "結果の種類" : "Result type"}</label>
              <select
                id="v2-search-filter-type"
                name="type"
                value={draftFilters.type ?? ""}
                onChange={(event) => setDraftFilters((current) => ({ ...current, type: (event.target.value || undefined) as HubSearchFilters["type"] }))}
              >
                <option value="">{japanese ? "すべての種類" : "All types"}</option>
                {HUB_SEARCH_TYPES.map((type) => <option key={type} value={type}>{KIND_LABEL[type][japanese ? "ja" : "en"]}</option>)}
              </select>
            </div>
            <div className="v2-search__filter-field">
              <label htmlFor="v2-search-filter-language">{japanese ? "言語" : "Language"}</label>
              <select
                id="v2-search-filter-language"
                name="language"
                value={draftFilters.language ?? ""}
                onChange={(event) => setDraftFilters((current) => ({ ...current, language: (event.target.value || undefined) as HubSearchFilters["language"] }))}
              >
                <option value="">{japanese ? "すべての言語" : "All languages"}</option>
                {HUB_SEARCH_LANGUAGES.map((language) => <option key={language} value={language}>{LANGUAGE_LABELS[language][japanese ? "ja" : "en"]}</option>)}
              </select>
            </div>
            <div className="v2-search__filter-field">
              <label htmlFor="v2-search-filter-region">{japanese ? "地域" : "Region"}</label>
              <input
                id="v2-search-filter-region"
                name="region"
                type="text"
                maxLength={80}
                value={draftFilters.region ?? ""}
                onChange={(event) => setDraftFilters((current) => ({ ...current, region: event.target.value }))}
              />
            </div>
            <div className="v2-search__filter-field">
              <label htmlFor="v2-search-filter-category">{japanese ? "カテゴリ" : "Category"}</label>
              <input
                id="v2-search-filter-category"
                name="category"
                type="text"
                maxLength={80}
                value={draftFilters.category ?? ""}
                onChange={(event) => setDraftFilters((current) => ({ ...current, category: event.target.value }))}
              />
            </div>
            <div className="v2-search__filter-field">
              <label htmlFor="v2-search-filter-from">{japanese ? "開始日" : "Start date"}</label>
              <input
                id="v2-search-filter-from"
                name="from"
                type="date"
                value={draftFilters.from}
                onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))}
              />
            </div>
            <div className="v2-search__filter-field">
              <label htmlFor="v2-search-filter-to">{japanese ? "終了日" : "End date"}</label>
              <input
                id="v2-search-filter-to"
                name="to"
                type="date"
                value={draftFilters.to}
                onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))}
              />
            </div>
            <div className="v2-search__filter-field v2-search__filter-field--price">
              <label htmlFor="v2-search-filter-max-price">{japanese ? "上限価格" : "Maximum price"}</label>
              <div className="v2-search__filter-price">
                <input
                  id="v2-search-filter-max-price"
                  name="maxPrice"
                  type="number"
                  min="0"
                  step={draftFilters.currency === "JPY" ? "1" : "0.01"}
                  inputMode={draftFilters.currency === "JPY" ? "numeric" : "decimal"}
                  value={draftFilters.maxPrice}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, maxPrice: event.target.value }))}
                />
                <label className="v2-search__filter-currency-label" htmlFor="v2-search-filter-currency">
                  {japanese ? "通貨" : "Currency"}
                </label>
                <select
                  id="v2-search-filter-currency"
                  name="currency"
                  value={draftFilters.currency}
                  onChange={(event) => setDraftFilters((current) => ({
                    ...current,
                    currency: event.target.value as HubSearchFilters["currency"],
                  }))}
                >
                  <option value="JPY">JPY</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>
          </div>
          <p className="v2-search__filter-note">
            {japanese
              ? "条件を入力し、検索ボタンで適用します。"
              : "Enter conditions, then select Search to apply them."}
          </p>
          <p className="v2-search__filter-note">
            {japanese
              ? "言語・地域・カテゴリが公開情報に設定された結果を探します。地域・カテゴリは一部の文字でも検索できます。"
              : "Matches language, region and category set in public information. Region and category can match part of a value."}
          </p>
          <p className="v2-search__filter-note">
            {japanese
              ? "期間は公開・更新日を日本時間で指定します。日付が不明な結果は除きます。"
              : "Dates use Japan time for publication or update days. Results without a known date are excluded."}
          </p>
          <p className="v2-search__filter-note">
            {japanese
              ? "価格指定時は金額が明らかな商品のみを表示します。通貨換算はしません。"
              : "With a price limit, only products with a clear amount and currency are shown. No currency conversion is used."}
          </p>
          <div className="v2-search__filter-actions">
            <button type="button" className="v2-toggle v2-toggle--text" onClick={clearFilters}>
              {japanese ? "絞り込みを解除" : "Clear filters"}
            </button>
          </div>
          {filterError ? <p className="v2-error" role="alert">{filterError}</p> : null}
        </details>
        {hasActiveSearch ? (
          <span className="v2-search__tools">
            {group === "all" && (results || status !== "idle") ? (
              <V2SearchTabs
                className="v2-search__groups v2-search__orders"
                label={japanese ? "検索結果の並び順" : "Search result order"}
                items={ORDERS.map((item) => ({ value: item.id, label: japanese ? item.ja : item.en }))}
                value={order}
                onChange={selectOrder}
              />
            ) : null}
            <button type="button" className="v2-toggle v2-toggle--text" aria-pressed={currentSavedSearch} onClick={toggleSavedSearch}>
              {currentSavedSearch ? (japanese ? "保存を解除" : "Remove saved search") : (japanese ? "検索を保存" : "Save search")}
            </button>
          </span>
        ) : null}
      </form>
      {suggestions.length ? (
        <ul id="v2-search-suggestions" className="v2-search__history v2-search__suggestions" role="listbox" aria-label={japanese ? "検索候補" : "Search suggestions"}>
          {suggestions.map((suggestion, index) => (
            <li key={suggestion}>
              <button
                type="button"
                role="option"
                id={`v2-search-suggestion-${index}`}
                aria-selected={index === activeSuggestion}
                className="v2-search__history-item"
                onClick={() => {
                  setDraft(suggestion);
                  setActiveSuggestion(-1);
                  submitSearch(suggestion);
                }}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {/* 種類の札。箱の直下に1行。実在しない種類も押せるが、押せば0件と出す（X の検索と同じ）。 */}
      {hasActiveSearch ? (
        <V2SearchTabs
          label={japanese ? "結果の種類" : "Result kinds"}
          items={GROUPS.map((item) => ({ value: item.id, label: japanese ? item.ja : item.en }))}
          value={group}
          onChange={selectGroup}
        />
      ) : null}

      {savedSearchError ? <p className="v2-error" role="alert">{japanese ? "保存した検索を更新できませんでした。" : "Saved search could not be updated."}</p> : null}

      {!hasActiveSearch ? (
        <section className="v2-search__idle">
          {savedSearches.length ? (
            <section className="v2-search__saved" aria-labelledby="v2-search-saved-title">
              <div className="v2-search__history-head">
                <h2 id="v2-search-saved-title" className="v2-column__title">{japanese ? "保存した検索" : "Saved searches"}</h2>
              </div>
              <ul className="v2-search__history">
                {savedSearches.map((saved) => (
                  <li key={savedSearchKey(saved)}>
                    <button type="button" className="v2-search__history-item" onClick={() => runSavedSearch(saved)}>
                      {formatSavedSearchLabel(saved, japanese)}
                    </button>
                    <button
                      type="button"
                      className="v2-toggle v2-toggle--text"
                      aria-label={japanese
                        ? `保存した検索「${formatSavedSearchLabel(saved, japanese)}」を削除`
                        : `Delete saved search ${formatSavedSearchLabel(saved, japanese)}`}
                      onClick={() => removeSavedSearch(saved)}
                    >
                      {japanese ? "削除" : "Delete"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <V2LegacySearchImport
            candidates={legacySearches}
            savedSearches={savedSearches}
            japanese={japanese}
            onImport={importLegacySearch}
          />
          {history.length ? (
            <>
              <div className="v2-search__history-head">
                <h2 className="v2-column__title">{japanese ? "検索履歴" : "History"}</h2>
                <button type="button" className="v2-toggle v2-toggle--text" onClick={clearHistory}>
                  {japanese ? "すべて削除" : "Clear all"}
                </button>
              </div>
              <ul className="v2-search__history">
                {history.map((entry) => (
                  <li key={entry}>
                    <button
                      type="button"
                      className="v2-search__history-item"
                      onClick={() => {
                        setDraft(entry);
                        submitSearch(entry);
                      }}
                    >
                      {entry}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="v2-note">
              {japanese
                ? "言葉を入れると、投稿・人物・スレッド・記事・商品を横断して探します。"
                : "Type to search across posts, people, threads, articles and products."}
            </p>
          )}
        </section>
      ) : null}

      {status === "loading" ? <p className="v2-note" role="status">{japanese ? "探しています…" : "Searching…"}</p> : null}

      {status === "failed" && !filterError ? (
        <p className="v2-error" role="alert">
          {japanese ? "検索できませんでした。" : "Search failed."}{" "}
          <button type="button" className="v2-toggle v2-toggle--text" onClick={() => void run(query, { push: false, filters: filtersRef.current })}>
            {japanese ? "もう一度" : "Retry"}
          </button>
        </p>
      ) : null}

      {hasActiveSearch && group === "images" ? (
        <V2ImageSearch key={query} query={query} signedIn={Boolean(viewerId)} japanese={japanese} />
      ) : null}

      {hasActiveSearch && group !== "images" && status === "idle" && results && !shown.length && !imageTiles.length && !moreOnServer && !serverLoading && !serverCursorError ? (
        <section className="v2-search__empty">
          <p className="v2-note">{japanese ? "一致する結果はありません。" : "Nothing matched."}</p>
          {alternatives.length ? (
            <p className="v2-search__alternatives">
              {japanese ? "もしかして: " : "Did you mean: "}
              {alternatives.map((alternative) => (
                <button
                  key={alternative}
                  type="button"
                  className="v2-search__alt"
                  onClick={() => {
                    setDraft(alternative);
                    submitSearch(alternative);
                  }}
                >
                  {alternative}
                </button>
              ))}
            </p>
          ) : null}
          {query ? (
            <p className="v2-note">
              <Link className="v2-card__link" href={`/v2/hubpedia?q=${encodeURIComponent(query)}`} onClick={() => markResultNavigation()}>
                {japanese ? "Hubpediaで調べる" : "Look it up on Hubpedia"}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {imageTiles.length ? (
        <section className="v2-search__images" aria-labelledby="v2-search-images-title">
          <h2 id="v2-search-images-title" className="v2-column__title v2-column__title--section">
            {japanese ? "画像" : "Images"}
          </h2>
          <ul className="v2-search__grid">
            {imageTiles.map((tile) => {
              const aspectRatio = imageAspectRatio(tile.width, tile.height);
              return (
                <li key={tile.key}>
                  <div className="v2-search__tile">
                    <button
                      type="button"
                      className="v2-search__image-button"
                      aria-label={japanese ? `画像を拡大: ${tile.alt || tile.caption}` : `Enlarge image: ${tile.alt || tile.caption}`}
                      onClick={(event) => {
                        imageOpenerRef.current = event.currentTarget;
                        setPreviewImageFailed(false);
                        setSelectedImage(tile);
                      }}
                    >
                      {failedImageIds.has(tile.key) ? (
                        <span className="v2-search__image-fallback" role="img" aria-label={japanese ? "画像を読み込めませんでした" : "Image could not be loaded"}>
                          {japanese ? "画像を表示できません" : "Image unavailable"}
                        </span>
                      ) : (
                        <img
                          src={tile.url}
                          alt={tile.alt}
                          loading="lazy"
                          decoding="async"
                          style={aspectRatio ? { aspectRatio } : undefined}
                          onError={() => markImageFailed(tile.key)}
                        />
                      )}
                    </button>
                    {/* 題が無い画像もある。読み上げのために、投稿の本文の頭を添える。 */}
                    <Link className="v2-search__tile-caption" href={tile.href} onClick={() => markResultNavigation()}>
                      {tile.alt || tile.caption}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          <FirstPartyAdSlot placementKey="search.images.inline" variant="image-grid" context={imageAdContext} />
        </section>
      ) : null}

      {selectedImage ? (
        <div
          className="v2-search__image-preview"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeImagePreview();
          }}
        >
          <section
            className="v2-search__image-preview-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="v2-search-image-preview-title"
          >
            <header className="v2-search__image-preview-head">
              <div>
                <h2 id="v2-search-image-preview-title">{japanese ? "画像を確認" : "Image preview"}</h2>
                <span className="v2-search__image-preview-count" aria-live="polite">
                  {selectedImageIndex + 1} / {imageTiles.length}
                </span>
              </div>
              <button
                ref={imageCloseRef}
                type="button"
                className="v2-toggle v2-toggle--text"
                onClick={closeImagePreview}
                aria-label={japanese ? "画像プレビューを閉じる" : "Close image preview"}
              >
                {japanese ? "閉じる" : "Close"}
              </button>
            </header>
            {previewImageFailed ? (
              <p className="v2-search__image-fallback v2-search__image-preview-fallback" role="status">
                {japanese ? "画像を読み込めませんでした。" : "The image could not be loaded."}
              </p>
            ) : (
              <img
                className="v2-search__image-preview-media"
                src={selectedImage.fullUrl}
                alt={selectedImage.alt}
                draggable={false}
                onError={() => setPreviewImageFailed(true)}
                onPointerDown={onPreviewPointerDown}
                onPointerUp={onPreviewPointerUp}
                onPointerCancel={onPreviewPointerCancel}
              />
            )}
            <p className="v2-search__image-preview-caption">{selectedImage.alt || selectedImage.caption}</p>
            {imageTiles.length > 1 ? (
              <nav className="v2-search__image-preview-nav" aria-label={japanese ? "画像プレビューの移動" : "Image preview navigation"}>
                <button
                  type="button"
                  className="v2-toggle v2-toggle--text"
                  disabled={selectedImageIndex <= 0}
                  onClick={() => moveImagePreview(-1)}
                >
                  {japanese ? "前の画像" : "Previous image"}
                </button>
                <button
                  type="button"
                  className="v2-toggle v2-toggle--text"
                  disabled={selectedImageIndex < 0 || selectedImageIndex >= imageTiles.length - 1}
                  onClick={() => moveImagePreview(1)}
                >
                  {japanese ? "次の画像" : "Next image"}
                </button>
              </nav>
            ) : null}
            <Link className="v2-card__link" href={selectedImage.href} onClick={() => markResultNavigation()}>
              {selectedImage.destination === "product"
                ? (japanese ? "商品を見る" : "Open product")
                : (japanese ? "投稿を見る" : "Open post")}
            </Link>
            {relatedImageTiles.length ? (
              <section className="v2-search__related" aria-labelledby="v2-search-related-images-title">
                <h3 id="v2-search-related-images-title" className="v2-column__title v2-column__title--section">
                  {japanese ? "関連画像" : "Related images"}
                </h3>
                <ul className="v2-search__grid v2-search__related-grid">
                  {relatedImageTiles.map((tile) => {
                    const aspectRatio = imageAspectRatio(tile.width, tile.height);
                    return (
                      <li key={tile.key}>
                        <button
                          type="button"
                          className="v2-search__image-button"
                          aria-label={japanese ? `関連画像を拡大: ${tile.alt || tile.caption}` : `Enlarge related image: ${tile.alt || tile.caption}`}
                          onClick={() => {
                            // Keep the original grid trigger as the return
                            // target. Related-image buttons live inside the
                            // dialog and disappear when it closes.
                            setPreviewImageFailed(false);
                            setSelectedImage(tile);
                          }}
                        >
                          {failedImageIds.has(tile.key) ? (
                            <span className="v2-search__image-fallback" role="img" aria-label={japanese ? "画像を読み込めませんでした" : "Image could not be loaded"}>
                              {japanese ? "画像を表示できません" : "Image unavailable"}
                            </span>
                          ) : (
                            <img
                              src={tile.url}
                              alt={tile.alt || tile.caption}
                              loading="lazy"
                              decoding="async"
                              style={aspectRatio ? { aspectRatio } : undefined}
                              onError={() => markImageFailed(tile.key)}
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </section>
        </div>
      ) : null}

      {hasActiveSearch && results && (shown.length || moreOnServer || serverCursorError) ? (
        <>
          {shown.length ? (
            <ul className="v2-search__results">
              {shown.map((item) => (
                <li
                  key={`${item.sourceGroup}:${item.id}`}
                  className={item.sourceGroup === "posts" && detail.posts.has(item.id) ? "v2-search__post" : undefined}
                  onClickCapture={item.sourceGroup === "posts" && detail.posts.has(item.id) ? onPostCardClick : undefined}
                >
                  {renderResult(item)}
                </li>
              ))}
            </ul>
          ) : null}
          {hasMoreResults ? (
            <div ref={resultLoadMoreRef} className="v2-search__load-more">
              <button type="button" className="v2-toggle v2-toggle--text" onClick={() => void loadMoreResults()} disabled={serverLoading} aria-busy={serverLoading}>
                {serverLoading
                  ? (japanese ? "読み込み中…" : "Loading…")
                  : (japanese ? "さらに表示" : "Load more")}
              </button>
              <span aria-live="polite">
                {japanese
                  ? `${shown.length} / ${moreOnServer ? `${ordered.length}+` : ordered.length} 件`
                  : `${shown.length} / ${moreOnServer ? `${ordered.length}+` : ordered.length} results`}
              </span>
            </div>
          ) : null}
          {canLoadMoreKind ? (
            <div className="v2-search__load-more">
              <button type="button" className="v2-toggle v2-toggle--text" onClick={() => void loadMoreKind()} disabled={moreLoading} aria-busy={moreLoading}>
                {moreLoading ? (japanese ? "読み込み中…" : "Loading…") : (japanese ? "もっと見る" : "See more")}
              </button>
              {moreError ? (
                <span role="alert">{japanese ? "続きを取得できませんでした。" : "More results could not be loaded."}</span>
              ) : null}
            </div>
          ) : null}
          {serverCursorError ? (
            <p className="v2-error" role="alert">
              {japanese ? "続きの検索を取得できませんでした。" : "More search results could not be loaded."}{" "}
              <button type="button" className="v2-toggle v2-toggle--text" onClick={() => void run(query, { push: false, filters: filtersRef.current })}>
                {japanese ? "検索をやり直す" : "Restart search"}
              </button>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
