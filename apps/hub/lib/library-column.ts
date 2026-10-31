/*
 * 左の列の「自分のもの」(2026-10-29)。節ごとの行の型と、固定・件数の純粋な規則。
 * サーバーの読み出しは lib/server/library-column.ts、表示は components/v2/v2-library-column.tsx。
 */
export const LIBRARY_SECTIONS = ["feed", "articles", "videos", "music", "market", "games", "research"] as const;
export type LibrarySection = (typeof LIBRARY_SECTIONS)[number];

/** 列に出す行の上限（1つの群あたり）。超えたら「すべて見る」。 */
export const LIBRARY_VISIBLE_MAX = 6;
/** 1つの群で読む行の上限。固定を含めて並べ替えるための余裕で、これ以上は読まない。 */
export const LIBRARY_READ_MAX = 30;
/** 1節あたりの固定の上限。 */
export const LIBRARY_PIN_MAX = 40;

import type { TagChipKind } from "@/lib/tag-href";

export type LibraryIcon = "people" | "list" | "article" | "video" | "music" | "store" | "game" | "research" | "bookmark" | "clock" | "heart" | "edit" | "plus";

export type LibraryItem = {
  /** "<kind>:<id>"。固定の鍵。 */
  key: string;
  label: string;
  href: string;
  icon?: LibraryIcon;
  /** 公開の画像（https:// か / のみ）。 */
  imageUrl?: string | null;
  /** 人の行は丸、コミュニティ・ゲームなどは角丸。 */
  shape?: "person" | "place";
  /** 件数つきの行（下書き・カート・お気に入り）。 */
  count?: number | null;
  /** 固定できる行か。件数だけの入口の行は固定しない。 */
  pinnable?: boolean;
  pinned?: boolean;
  /** タグの行。V2TagChip で出し、その種類のタブで開く。 */
  tag?: string;
  chipKind?: TagChipKind;
};

/** よく使われているタグ。server は D1 の content_tag_links、remote はブラウザが公開 API から読む。 */
export type LibraryPopularTags = { kind: TagChipKind; tags: string[]; remote: "music" | "market" | null };

export type LibraryGroup = {
  id: string;
  title: string;
  items: LibraryItem[];
  /** 「すべて見る」の行き先。群に読み残しがあるとき、または常設の入口として。 */
  seeAllHref?: string;
  /** 読み残しがある（上限で打ち切った）。 */
  more?: boolean;
  /** 空のときの一行と一つの行動。 */
  empty: { text: string; action: { label: string; href: string } };
};

export type LibraryColumnData = {
  section: LibrarySection;
  groups: LibraryGroup[];
  popular: LibraryPopularTags | null;
  /** この節で固定している鍵。 */
  pins: string[];
};

export function isLibrarySection(value: unknown): value is LibrarySection {
  return typeof value === "string" && (LIBRARY_SECTIONS as readonly string[]).includes(value);
}

/** 固定の鍵は "<kind>:<id>"（kind は英小文字とハイフン、id は制御文字なし 1〜190 文字）。 */
export function isLibraryItemKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && /^[a-z][a-z-]{0,23}:[^\u0000-\u001f\u007f]{1,190}$/u.test(value);
}

/** 公開画像として使えるURLだけ通す。 */
export function safeLibraryImage(url: string | null | undefined): string | null {
  return typeof url === "string" && (url.startsWith("/") && !url.startsWith("//") || url.startsWith("https://")) ? url : null;
}

/** 固定を先頭に（元の順は保つ）、上限で切る。切り落としが出たら more。 */
export function applyLibraryPins(items: LibraryItem[], pins: ReadonlySet<string>, visibleMax = LIBRARY_VISIBLE_MAX): { items: LibraryItem[]; more: boolean } {
  const marked = items.map((item) => (item.pinnable === false ? item : { ...item, pinned: pins.has(item.key) }));
  const pinned = marked.filter((item) => item.pinned);
  const rest = marked.filter((item) => !item.pinned);
  const ordered = [...pinned, ...rest];
  return { items: ordered.slice(0, visibleMax), more: ordered.length > visibleMax };
}
