import { isHubOriginalWork, type MusicWork } from "@/lib/music-catalog";

/*
 * Hub のオリジナル曲を先に、YouTube などの外部の曲は足りない分の穴埋めにだけ使う
 * （2026-10-14、旦那様の決定）。表示順・件数配分の規則はここに集める。純粋関数のみ。
 */

/** 1つの枠（棚・格子）の標準の件数。オリジナルで埋まれば外部の曲は出さない。 */
export const MUSIC_SLOT_SIZE = 12;
/** 検索でオリジナルがこの件数以上あるとき、外部の曲は折りたたむ。 */
export const MUSIC_SEARCH_COLLAPSE_AT = 5;
/** オリジナルがこの件数より少ないときだけ、外部の曲のジャンル棚を出す。 */
export const MUSIC_EXTERNAL_BROWSE_BELOW = 6;

export function splitByOrigin<T extends Pick<MusicWork, "id">>(works: readonly T[]): { originals: T[]; external: T[] } {
  const originals: T[] = [];
  const external: T[] = [];
  for (const work of works) (isHubOriginalWork(work) ? originals : external).push(work);
  return { originals, external };
}

/** 順序を保ったまま、オリジナルを前へ。 */
export function originalsFirst<T extends Pick<MusicWork, "id">>(works: readonly T[]): T[] {
  const { originals, external } = splitByOrigin(works);
  return [...originals, ...external];
}

/**
 * 枠を埋める。オリジナルを先に最大 size 件、足りない分だけ外部の曲で埋める。
 * オリジナルが size 件以上なら外部の曲は 0 件。
 */
export function fillSlot<T extends Pick<MusicWork, "id">>(
  originals: readonly T[],
  external: readonly T[],
  size: number = MUSIC_SLOT_SIZE,
): { originals: T[]; external: T[] } {
  const head = originals.slice(0, Math.max(0, size));
  const room = Math.max(0, size - head.length);
  const ids = new Set(head.map((work) => work.id));
  return { originals: head, external: external.filter((work) => !ids.has(work.id)).slice(0, room) };
}

/** 検索・絞り込みの結果。オリジナルが多ければ外部の曲は折りたたむ。 */
export function searchLayout<T extends Pick<MusicWork, "id">>(
  works: readonly T[],
  collapseAt: number = MUSIC_SEARCH_COLLAPSE_AT,
): { originals: T[]; external: T[]; collapseExternal: boolean } {
  const { originals, external } = splitByOrigin(works);
  return { originals, external, collapseExternal: originals.length >= collapseAt && external.length > 0 };
}

/**
 * 続けて再生する待ち行列。開始曲を先頭に、残りはオリジナル、外部の曲の順。
 * 外部の曲はオリジナルの候補が尽きてからだけ鳴る。
 */
export function orderPlaybackQueue<T extends Pick<MusicWork, "id">>(works: readonly T[], startId?: string): T[] {
  const start = startId ? works.find((work) => work.id === startId) : undefined;
  const rest = originalsFirst(works.filter((work) => work !== start));
  return start ? [start, ...rest] : rest;
}
