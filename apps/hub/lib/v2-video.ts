import type { PublicVideoEntry } from "@/lib/server/d1-videos";
import { isVerticalVideo } from "@/lib/video-display-format";

/*
 * 動画の純粋な計算。サーバー（一覧の頁）とクライアント（もっと見る・順位）の
 * 両方から使うので "use client" を付けない（lib/v2-time.ts と同じ理由）。
 *
 * 既存の video-discovery.tsx は同じ計算をクライアントの中に持っていて、
 * 一覧の最初の描画には使えなかった。ここへ出して、最初の頁はサーバーで絞る。
 * 判定の式は既存と同じにする（長さの境目・言語の正規表現・関連の重み）。
 */

export const V2_PROVIDER_LABELS: Record<PublicVideoEntry["provider"], string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  twitch: "Twitch",
  niconico: "ニコニコ動画",
  tiktok: "TikTok",
  dailymotion: "Dailymotion",
  peertube: "PeerTube",
  hub: "Hub動画",
};

export const V2_PURPOSE_LABELS: Record<PublicVideoEntry["purpose"], { ja: string; en: string }> = {
  guide: { ja: "ガイド", en: "Guide" },
  explanation: { ja: "解説", en: "Explainer" },
  live: { ja: "ライブ", en: "Live" },
  review: { ja: "レビュー", en: "Review" },
  creation: { ja: "制作", en: "Making" },
  music: { ja: "音楽", en: "Music" },
  other: { ja: "その他", en: "Other" },
};

export type V2VideoLength = "" | "under4" | "4to20" | "over20";
export type V2VideoDate = "" | "week" | "month" | "year";
export type V2VideoLanguage = "" | "ja" | "latin";

export type V2VideoFilters = {
  provider: string;
  category: string;
  length: V2VideoLength;
  date: V2VideoDate;
  language: V2VideoLanguage;
  query: string;
  shorts: boolean;
};

export function durationSeconds(duration: string | null | undefined): number | null {
  const parts = duration?.split(":").map(Number);
  if (!parts?.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/* 縦型か、60秒以下。既存の isShortVideo と同じ。 */
type FilterableVideo = Pick<PublicVideoEntry, "title" | "channel" | "category" | "topic" | "provider" | "sourceUrl" | "duration" | "publishedAt" | "availabilityStatus"> & { broadcastStatus?: PublicVideoEntry["broadcastStatus"] };

export function isShort(video: FilterableVideo): boolean {
  /* ライブ中・配信予定はショートに数えない。 */
  if (video.broadcastStatus === "live" || video.broadcastStatus === "upcoming") return false;
  if (isVerticalVideo(video)) return true;
  const seconds = durationSeconds(video.duration);
  return seconds !== null && seconds > 0 && seconds <= 60;
}

const JAPANESE = /[぀-ヿ一-鿿]/;
const LATIN_ONLY = /^[\x20-\x7e -ɏ -⁯]+$/;

export function matchesVideoFilters(video: FilterableVideo, filters: V2VideoFilters, now = Date.now()): boolean {
  if (video.availabilityStatus === "unavailable") return false;
  if (filters.shorts !== isShort(video)) return false;
  if (filters.provider && video.provider !== filters.provider) return false;
  if (filters.category && video.category !== filters.category) return false;
  if (filters.length) {
    const seconds = durationSeconds(video.duration);
    if (seconds === null) return false;
    if (filters.length === "under4" && seconds >= 240) return false;
    if (filters.length === "4to20" && (seconds < 240 || seconds > 1200)) return false;
    if (filters.length === "over20" && seconds <= 1200) return false;
  }
  if (filters.date) {
    const published = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
    if (!Number.isFinite(published)) return false;
    const days = filters.date === "week" ? 7 : filters.date === "month" ? 31 : 366;
    if (now - published > days * 24 * 60 * 60 * 1000) return false;
  }
  if (filters.language) {
    const text = `${video.title} ${video.channel}`;
    if (filters.language === "ja" && !JAPANESE.test(text)) return false;
    if (filters.language === "latin" && !LATIN_ONLY.test(text)) return false;
  }
  if (filters.query) {
    const haystack = `${video.title} ${video.channel} ${video.category} ${video.topic} ${V2_PROVIDER_LABELS[video.provider]}`.toLocaleLowerCase("ja");
    if (!haystack.includes(filters.query.toLocaleLowerCase("ja"))) return false;
  }
  return true;
}

/* 既存の詳細ページと同じ重み: 話題4・チャンネル2・分類1、同点は新しい順。 */
export function relatedVideos(video: PublicVideoEntry, candidates: PublicVideoEntry[], limit = 12): PublicVideoEntry[] {
  const score = (candidate: PublicVideoEntry) =>
    (candidate.topic === video.topic ? 4 : 0)
    + (candidate.channel === video.channel ? 2 : 0)
    + (candidate.category === video.category ? 1 : 0);
  return candidates
    .filter((candidate) => candidate.id !== video.id && isShort(candidate) === isShort(video))
    .sort((left, right) => score(right) - score(left) || Date.parse(right.publishedAt ?? "") - Date.parse(left.publishedAt ?? ""))
    .slice(0, limit);
}

export function videoFiltersFromParams(params: Record<string, string | string[] | undefined>): V2VideoFilters {
  const one = (value: string | string[] | undefined) => ((Array.isArray(value) ? value[0] : value) ?? "").trim();
  const pick = <T extends string>(value: string, allowed: readonly T[]): T | "" => (allowed as readonly string[]).includes(value) ? value as T : "";
  return {
    provider: pick(one(params.provider), Object.keys(V2_PROVIDER_LABELS)),
    category: one(params.category).slice(0, 80),
    length: pick(one(params.length), ["under4", "4to20", "over20"] as const),
    date: pick(one(params.date), ["week", "month", "year"] as const),
    language: pick(one(params.lang), ["ja", "latin"] as const),
    query: one(params.q).slice(0, 100),
    shorts: one(params.mode) === "shorts",
  };
}
