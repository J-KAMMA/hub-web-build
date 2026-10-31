import { getArticleCategoryIds, getEncyclopediaCategoryPath } from "./categories";
import type { ViewableSeedArticle } from "./seed";

const generic = new Set([
  "概要", "背景", "歴史", "仕組み", "具体例", "関連項目", "関連記事", "出典", "参考文献", "課題", "現在",
  "定義", "構造", "技術", "環境", "健康", "社会", "社会的", "作品", "言語", "文化", "政治", "経済", "研究", "知識",
  "役割", "論点", "記録", "上演", "翻訳", "検索", "文書", "スタイル", "検査", "発生",
  "overview", "background", "history", "mechanism", "examples", "related articles", "sources", "references",
]);
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/gu, " ").trim();

function add(scores: Map<string, number>, labels: Map<string, string>, excluded: Set<string>, label: string, score: number) {
  const value = label.replace(/^#+\s*/u, "").trim();
  const key = normalized(value);
  if (value.length < 2 || value.length > 32 || generic.has(key) || excluded.has(key)) return;
  if (score > (scores.get(key) ?? 0)) scores.set(key, score);
  if (!labels.has(key)) labels.set(key, value);
}

function isConciseConcept(value: string) {
  const compact = value.replace(/\s+/g, "").trim();
  if (compact.length > 14) return false;
  return !/(?:から|まで|について|における|ではない|しない|する|される|変える|含める|持つ|から.+へ|[をがへ].+(?:る|ない))$/u.test(compact);
}

export function getAutomaticArticleTags(article: ViewableSeedArticle, catalog: readonly ViewableSeedArticle[] = [], limit = 8) {
  const scores = new Map<string, number>();
  const labels = new Map<string, string>();
  const categoryLabels = new Set(
    getArticleCategoryIds(article).flatMap((categoryId) => getEncyclopediaCategoryPath(categoryId).map((node) => normalized(node.name))),
  );
  const excluded = new Set([normalized(article.title), ...categoryLabels]);
  const record = (label: string, score: number) => add(scores, labels, excluded, label, score);
  const headings = [...article.bodyMarkdown.matchAll(/^#{2,3}\s+(.+)$/gmu)].map((match) => match[1]);
  const searchable = normalized(`${article.title} ${article.summary ?? ""} ${headings.join(" ")}`);
  const linkedSlugs = new Set(
    [...article.bodyMarkdown.matchAll(/\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g)].map((match) => match[1]),
  );

  for (const candidate of catalog) {
    if (candidate.slug === article.slug) continue;
    const title = candidate.title.trim();
    if (linkedSlugs.has(candidate.slug)) record(title, 100);
    else if (title.length >= 2 && searchable.includes(normalized(title))) record(title, 72);
  }
  for (const heading of headings) {
    for (const part of heading.split(/[・、,／/]/u)) if (isConciseConcept(part)) record(part, 55);
  }
  for (const match of searchable.matchAll(/[a-z][a-z0-9+-]{2,}/gu)) record(match[0].toUpperCase(), 45);

  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
    .slice(0, Math.max(0, Math.min(limit, 8)))
    .map(([key]) => labels.get(key) ?? key);
}

/*
 * A tag is only worth showing a reader if it leads somewhere else. The
 * headings a single article happens to use — 社会と生態, テキストと協働 —
 * score well and are useful inside search, but as a visible control they
 * promise a sideways move that does not exist. Only tags two or more articles
 * share keep that promise.
 *
 * The catalogue is a static seed, so the index is built once and reused rather
 * than recomputed for every article view.
 */
const sharedTagCache = new WeakMap<readonly ViewableSeedArticle[], Set<string>>();

function sharedTagIndex(catalog: readonly ViewableSeedArticle[]): Set<string> {
  const cached = sharedTagCache.get(catalog);
  if (cached) return cached;

  const counts = new Map<string, number>();
  for (const article of catalog) {
    for (const tag of new Set(getAutomaticArticleTags(article, catalog))) {
      counts.set(normalized(tag), (counts.get(normalized(tag)) ?? 0) + 1);
    }
  }
  const shared = new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([key]) => key));
  sharedTagCache.set(catalog, shared);
  return shared;
}

/*
 * A tag that names another article is already a sideways move, even when only
 * one article carries it. That is the whole point of showing it, so it counts
 * alongside the tags two articles share.
 */
const titleCache = new WeakMap<readonly ViewableSeedArticle[], Set<string>>();

function articleTitles(catalog: readonly ViewableSeedArticle[]): Set<string> {
  const cached = titleCache.get(catalog);
  if (cached) return cached;
  const titles = new Set(catalog.map((article) => normalized(article.title)));
  titleCache.set(catalog, titles);
  return titles;
}

export function getSharedArticleTags(
  article: ViewableSeedArticle,
  catalog: readonly ViewableSeedArticle[],
): string[] {
  const shared = sharedTagIndex(catalog);
  const titles = articleTitles(catalog);
  const own = normalized(article.title);
  return getAutomaticArticleTags(article, catalog).filter((tag) => {
    const key = normalized(tag);
    return shared.has(key) || (titles.has(key) && key !== own);
  });
}
