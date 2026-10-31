import {
  isHubOriginalWork,
  isPlayableMusicWork,
  musicDisplayTitle,
  musicGenreLabel,
  musicWorkArtworkUrl,
  type MusicServiceLink,
  type MusicWork,
} from "@/lib/music-catalog";
import type { PersistentMusicTrack } from "@/lib/music-player-events";

/*
 * 音楽の純粋な計算。既存の music-discovery.tsx の中にあった写像を lib へ出す。
 * サーバー（一覧の頁）とクライアント（再生・絞り込み）の両方から使う。
 */

/* Hub内で再生できる配信元。既存は YouTube の埋め込みだけを「Hub内再生」と数える。 */
export function playableService(work: MusicWork): MusicServiceLink | null {
  return work.services.find((service) => service.provider === "youtube" && Boolean(service.embedUrl)) ?? null;
}

/* 既存の externalPersistentTrack と同じ形。ここを変えると常駐プレーヤーが受け取れない。 */
export function persistentTrack(work: MusicWork, service: MusicServiceLink, autoplay = true): PersistentMusicTrack {
  return {
    id: work.id,
    title: musicDisplayTitle(work.title),
    artist: work.artist,
    genre: work.genre,
    tags: work.tags,
    provider: service.provider,
    providerLabel: service.label,
    artworkUrl: musicWorkArtworkUrl(work),
    embedUrl: service.embedUrl,
    externalUrl: service.url,
    autoplay,
  };
}

/*
 * 一覧から常駐プレーヤーへ渡す曲。Hub のオリジナルは Music Worker の音声
 * （/music/api/tracks/<id>/audio。Hub は中継しない）、外部の曲は YouTube の埋め込みだけ。
 * 外部の曲の同意の確認は常駐プレーヤー側（クリックで読み込み）のまま。
 */
export function playableTrack(work: MusicWork, autoplay = true): PersistentMusicTrack | null {
  if (isHubOriginalWork(work)) {
    return {
      id: work.id,
      title: musicDisplayTitle(work.title),
      artist: work.artist,
      genre: work.genre,
      tags: work.tags,
      provider: "hub",
      providerLabel: "Hub Music",
      artworkUrl: musicWorkArtworkUrl(work),
      audioUrl: `/music/api/tracks/${work.id.slice("music:".length).toLowerCase()}/audio`,
      autoplay,
    };
  }
  const service = playableService(work);
  return service ? persistentTrack(work, service, autoplay) : null;
}

/* 行の小さな札。オリジナルは「Hub Music」、YouTube の曲は「YouTube Music」（提供元の名前）と明示する。購入を思わせる語は使わない。 */
export function musicOriginLabel(work: MusicWork, japanese: boolean): { kind: "original" | "external"; text: string } {
  if (isHubOriginalWork(work)) return { kind: "original", text: "Hub Music" };
  const provider = work.services.find((service) => service.provider === "youtube")?.label ?? work.services[0]?.label ?? "YouTube";
  return { kind: "external", text: provider };
}

export type V2MusicSort = "recommended" | "popular" | "latest" | "favorites";

export type V2MusicFilters = {
  genre: string;
  tags: string[];
  query: string;
};

export function musicFiltersFromParams(params: Record<string, string | string[] | undefined>): V2MusicFilters {
  const list = (value: string | string[] | undefined) => (Array.isArray(value) ? value : value ? [value] : []);
  const one = (value: string | string[] | undefined) => ((Array.isArray(value) ? value[0] : value) ?? "").trim();
  return {
    genre: one(params.genre).slice(0, 80),
    tags: [...new Set(list(params.tag).map((tag) => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 8),
    query: one(params.q).slice(0, 180),
  };
}

/*
 * 静的カタログの側の絞り込み。コミュニティ作品はサーバー（/api/music）が絞る。
 * 語は題・作者・ジャンル・タグの部分一致（既存の文字列一致と同じ範囲）。
 */
export function matchesMusicFilters(work: MusicWork, filters: V2MusicFilters): boolean {
  if (!isPlayableMusicWork(work)) return false;
  if (filters.genre && work.genre !== filters.genre) return false;
  if (filters.tags.length && !filters.tags.every((tag) => work.tags?.includes(tag))) return false;
  if (filters.query) {
    const haystack = `${work.title} ${work.artist} ${work.album ?? ""} ${work.genre} ${(work.tags ?? []).join(" ")}`.toLocaleLowerCase("ja");
    if (!haystack.includes(filters.query.toLocaleLowerCase("ja"))) return false;
  }
  return true;
}

/* ジャンルチップ用の表示名。絞り込みの値（生のジャンル）は変えない。 */
const MUSIC_CHIP_LABELS: Record<string, string> = { ambient: "アンビエント", field: "フィールド録音", piano: "ピアノ" };

export function musicGenreChipLabel(genre: string): string {
  const key = genre.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  const mapped = MUSIC_CHIP_LABELS[key];
  if (mapped) return mapped;
  const label = musicGenreLabel(genre);
  return /^[a-z]/.test(label) ? label.charAt(0).toLocaleUpperCase("en-US") + label.slice(1) : label;
}

/* 「プレイリスト」はジャンルではない。チップ列には出さない。 */
export function isMusicChipGenre(genre: string): boolean {
  return !/^(?:プレイリスト|playlists?)$/iu.test(genre.normalize("NFKC").trim());
}
