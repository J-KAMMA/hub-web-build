import { tagSlug } from "@jkamma/content-tags";

import { TAG_COUNT_CAP, TAG_KINDS, type TagKind } from "@/lib/server/d1-tag-search";
import type { V2FeedTab } from "@/components/v2/v2-feed-tabs";

/* Tag page kinds: すべて plus one tab per kind that carries tags. Counts come from visible links only. */
export type TagView = TagKind;
export const TAG_VIEWS: readonly TagView[] = TAG_KINDS;

const LABELS: Record<TagView, { ja: string; en: string }> = {
  posts: { ja: "投稿", en: "Posts" },
  threads: { ja: "スレッド", en: "Threads" },
  articles: { ja: "記事", en: "Articles" },
  videos: { ja: "動画", en: "Video" },
  music: { ja: "音楽", en: "Music" },
  market: { ja: "マーケット", en: "Market" },
};

export function tagViewLabel(view: TagView, japanese: boolean): string {
  return japanese ? LABELS[view].ja : LABELS[view].en;
}

export function parseTagView(value: string | undefined): TagView | null {
  return TAG_VIEWS.includes(value as TagView) ? value as TagView : null;
}

/** A count at the scan cap is shown as "1000+". */
export function formatTagCount(count: number): string {
  return count >= TAG_COUNT_CAP ? `${TAG_COUNT_CAP}+` : String(count);
}

/* One row of tabs: すべて + each kind with its count. `tag` is any spelling; links use the canonical slug. */
export function v2TagTabs(input: { tag: string; selected: TagView | null; counts: Record<TagView, number>; japanese: boolean }): V2FeedTab[] {
  const base = `/v2/tag/${tagSlug(input.tag) ?? encodeURIComponent(input.tag)}`;
  const total = TAG_VIEWS.reduce((sum, kind) => sum + input.counts[kind], 0);
  const tab = (view: TagView | null, count: number): V2FeedTab => ({
    key: view ?? "all",
    label: `${view ? tagViewLabel(view, input.japanese) : (input.japanese ? "すべて" : "All")} ${formatTagCount(count)}`,
    href: view ? `${base}?kind=${view}` : base,
    selected: input.selected === view,
  });
  return [tab(null, total), ...TAG_VIEWS.map((view) => tab(view, input.counts[view]))];
}
