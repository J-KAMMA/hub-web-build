/**
 * クライアント向けフィードの、DBに触らない部分。
 *
 * サーバ専用の取り込み（`server-only`）から切り離してある。混ざっていると、
 * 入力の絞り込みと渡す形——**間違えると外へ影響が出る所**——がテストで
 * 確かめられなくなる。実際に確かめられなくなっていた。
 */


import { MAX_LIST_OFFSET } from "@/lib/server/list-pagination";
/** 一度に返す上限。端末の画面に一度で収まる量を超えても、無駄に運ぶだけ。 */
export const MAX_FEED_LIMIT = 50;
const DEFAULT_FEED_LIMIT = 20;

export type FeedScope = "all" | "latest" | "following" | "popular" | "recommended";
const SCOPES: readonly FeedScope[] = ["all", "latest", "following", "popular", "recommended"];

export function readScope(raw: string | null): FeedScope {
  return SCOPES.includes(raw as FeedScope) ? (raw as FeedScope) : "all";
}

export function readLimit(raw: string | null): number {
  const asked = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(asked) || asked <= 0) return DEFAULT_FEED_LIMIT;
  return Math.min(asked, MAX_FEED_LIMIT);
}

export function readOffset(raw: string | null): number {
  const asked = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIST_OFFSET) : 0;
}

/**
 * 端末へ渡す形。
 *
 * **中身を丸ごと渡さない。** 画面が使っている型には、その場の描画にしか
 * 要らないものが混ざっている。そこへ乗ったまま出すと、画面の都合で変えた
 * ときにアプリが黙って壊れる。渡すものをここで決めておく。
 *
 * 画像・タグ・引用元は投稿の中身そのもの——落とすとWebとアプリで
 * 違う投稿が見える。描画にだけ要る値（v2 の referenced.avatarLabel など）
 * はここにも入れない。
 */
export type ClientFeedImage = {
  id: string;
  url: string;
  width: number;
  height: number;
  altText: string;
};

export type ClientFeedReference = {
  label: string;
  title: string;
  body: string;
  href: string;
  contextLabel?: string;
};

export type ClientFeedPost = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorHandle: string | null;
  authorProfileId: string | null;
  avatarUrl: string | null;
  replyCount: number;
  repostCount: number;
  likeCount: number;
  likedByViewer: boolean;
  bookmarkedByViewer: boolean;
  /** 視ている人のリポスト投稿のID。取り消しはこのIDをDELETEする。 */
  viewerRepostId: string | null;
  images: ClientFeedImage[];
  tags: string[];
  /** 引用・リポスト・返信元の札。無い投稿は null。 */
  referenced: ClientFeedReference | null;
};

type TimelineLike = {
  id: string;
  body?: string | null;
  createdAt?: string | null;
  authorName?: string | null;
  authorHandle?: string | null;
  authorProfileId?: string | null;
  /** D1タイムライン側は displayName/handle で返す——どちらで来ても拾う。 */
  displayName?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
  replyCount?: number | null;
  repostCount?: number | null;
  likeCount?: number | null;
  /** D1タイムライン側の視認者リアクション。like の1種だけ。 */
  viewerReaction?: "like" | null;
  likedByViewer?: boolean | null;
  bookmarked?: boolean | null;
  viewerRepostId?: string | null;
  images?: Array<Partial<ClientFeedImage>> | null;
  tags?: string[] | null;
  referenced?: Partial<ClientFeedReference> | null;
};

function toClientImage(image: Partial<ClientFeedImage>): ClientFeedImage | null {
  if (typeof image.id !== "string" || !image.id || typeof image.url !== "string" || !image.url) return null;
  return {
    id: image.id,
    url: image.url,
    width: Number.isFinite(image.width) ? Number(image.width) : 0,
    height: Number.isFinite(image.height) ? Number(image.height) : 0,
    altText: typeof image.altText === "string" ? image.altText : "",
  };
}

function toClientReference(raw: Partial<ClientFeedReference> | null | undefined): ClientFeedReference | null {
  if (!raw || typeof raw.href !== "string" || !raw.href) return null;
  return {
    label: typeof raw.label === "string" ? raw.label : "",
    title: typeof raw.title === "string" ? raw.title : "",
    body: typeof raw.body === "string" ? raw.body : "",
    href: raw.href,
    ...(typeof raw.contextLabel === "string" && raw.contextLabel ? { contextLabel: raw.contextLabel } : {}),
  };
}

export function toClientPost(post: TimelineLike): ClientFeedPost {
  return {
    id: post.id,
    body: post.body ?? "",
    createdAt: post.createdAt ?? "",
    authorName: post.authorName ?? post.displayName ?? "",
    authorHandle: post.authorHandle ?? post.handle ?? null,
    authorProfileId: post.authorProfileId ?? null,
    avatarUrl: post.avatarUrl ?? null,
    replyCount: post.replyCount ?? 0,
    repostCount: post.repostCount ?? 0,
    likeCount: post.likeCount ?? 0,
    likedByViewer: post.likedByViewer === true || post.viewerReaction === "like",
    bookmarkedByViewer: post.bookmarked === true,
    viewerRepostId: post.viewerRepostId ?? null,
    images: (post.images ?? []).map(toClientImage).filter((image): image is ClientFeedImage => image !== null),
    tags: (post.tags ?? []).filter((tag): tag is string => typeof tag === "string" && tag.length > 0),
    referenced: toClientReference(post.referenced),
  };
}
