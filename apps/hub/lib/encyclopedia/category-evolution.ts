import { getAutomaticArticleTags } from "./automatic-tags";
import {
  ENCYCLOPEDIA_CATEGORIES,
  getArticleCategoryIds,
  getEncyclopediaCategoryNode,
  getEncyclopediaCategoryPath,
  isEncyclopediaCategoryOrDescendant,
  type EncyclopediaCategoryNode,
} from "./categories";
import type { ViewableSeedArticle } from "./seed";

export type DynamicCategoryState = "candidate" | "visible" | "established";
export interface DynamicCategoryNode extends EncyclopediaCategoryNode {
  state: DynamicCategoryState;
  articleCount: number;
  aliases: string[];
  requiresAiReview: boolean;
  dynamicDepth: number;
  parentIds?: string[];
}
export interface EvolvingCategoryIndex {
  dynamicNodes: DynamicCategoryNode[];
  articleCategoryIds: Map<string, string[]>;
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/gu, " ").trim();
}
function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const indexCache = new WeakMap<readonly ViewableSeedArticle[], EvolvingCategoryIndex>();
const blockedNames = new Set([
  "日本", "現在", "概要", "関連", "関連項目", "関連する中核記事", "参考文献", "出典", "分類", "その他",
  ...ENCYCLOPEDIA_CATEGORIES.map((category) => normalized(category.name)),
]);
const conceptAliases = new Map<string, { name: string; aliases: string[] }>([
  ["ai", { name: "人工知能", aliases: ["AI", "Artificial Intelligence", "人工知能"] }],
  ["artificial intelligence", { name: "人工知能", aliases: ["AI", "Artificial Intelligence", "人工知能"] }],
  ["人工知能", { name: "人工知能", aliases: ["AI", "Artificial Intelligence", "人工知能"] }],
  ["ml", { name: "機械学習", aliases: ["ML", "Machine Learning", "機械学習"] }],
  ["machine learning", { name: "機械学習", aliases: ["ML", "Machine Learning", "機械学習"] }],
  ["機械学習", { name: "機械学習", aliases: ["ML", "Machine Learning", "機械学習"] }],
]);
function canonicalConcept(tag: string) {
  return conceptAliases.get(normalized(tag)) ?? { name: tag.trim(), aliases: [tag.trim()] };
}

function isStrictSubset(child: Set<string>, parent: Set<string>) {
  if (child.size >= parent.size) return false;
  for (const slug of child) if (!parent.has(slug)) return false;
  return true;
}

export function buildEvolvingCategoryIndex(articles: readonly ViewableSeedArticle[], minimumArticles = 3): EvolvingCategoryIndex {
  if (minimumArticles === 3) {
    const cached = indexCache.get(articles);
    if (cached) return cached;
  }
  const groups = new Map<string, { parentId: string; name: string; aliases: string[]; slugs: Set<string> }>();
  for (const article of articles) {
    const parentId = getArticleCategoryIds(article).find((id) => id !== "maintenance/uncategorized");
    if (!parentId) continue;
    for (const tag of getAutomaticArticleTags(article, articles)) {
      const concept = canonicalConcept(tag);
      if (blockedNames.has(normalized(concept.name))) continue;
      const key = `${parentId}:${normalized(concept.name)}`;
      const group = groups.get(key) ?? { parentId, name: concept.name, aliases: concept.aliases, slugs: new Set<string>() };
      group.slugs.add(article.slug);
      groups.set(key, group);
    }
  }

  const accepted = [...groups.entries()]
    .filter(([, group]) => group.slugs.size >= minimumArticles)
    .sort((left, right) => right[1].slugs.size - left[1].slugs.size || left[0].localeCompare(right[0], "ja"));
  const retained = accepted;
  const ids = new Map(
    retained.map(([key, group]) => [key, `${group.parentId}/topic-${stableHash(key)}`]),
  );
  const parents = new Map<string, string>();
  const depths = new Map<string, number>();

  // A narrower concept becomes a child only when every matching article also
  // belongs to a broader concept and the broader set has at least two more
  // articles. This avoids inventing hierarchy from weak co-occurrence.
  for (const [key, group] of [...retained].sort((left, right) => right[1].slugs.size - left[1].slugs.size)) {
    const candidates = retained
      .filter(([candidateKey, candidate]) =>
        candidateKey !== key
        && candidate.parentId === group.parentId
        && candidate.slugs.size >= group.slugs.size + 2
        && isStrictSubset(group.slugs, candidate.slugs))
      .sort((left, right) => left[1].slugs.size - right[1].slugs.size || left[0].localeCompare(right[0], "ja"));
    const parent = candidates[0];
    if (parent) {
      parents.set(key, ids.get(parent[0])!);
      depths.set(key, (depths.get(parent[0]) ?? 1) + 1);
    } else {
      depths.set(key, 1);
    }
  }

  const dynamicNodes: DynamicCategoryNode[] = [];
  const memberships = new Map<string, string[]>();
  for (const [key, group] of retained) {
    const parentId = parents.get(key) ?? group.parentId;
    const id = ids.get(key)!;
    const state: DynamicCategoryState = group.slugs.size >= 10 ? "established" : group.slugs.size >= 5 ? "visible" : "candidate";
    dynamicNodes.push({
      id,
      name: group.name,
      description: `${group.name}に関する記事`,
      parentId,
      state,
      articleCount: group.slugs.size,
      aliases: group.aliases,
      requiresAiReview: state !== "established",
      dynamicDepth: depths.get(key) ?? 1,
    });
    if (state !== "candidate") for (const slug of group.slugs) memberships.set(slug, [...(memberships.get(slug) ?? []), id]);
  }
  const articleCategoryIds = new Map(articles.map((article) => [article.slug, [...getArticleCategoryIds(article), ...(memberships.get(article.slug) ?? [])]]));
  const result = { dynamicNodes, articleCategoryIds };
  if (minimumArticles === 3) indexCache.set(articles, result);
  return result;
}

export function getEvolvingCategoryNode(index: EvolvingCategoryIndex, id: string) {
  return getEncyclopediaCategoryNode(id) ?? index.dynamicNodes.find((node) => node.id === id && node.state !== "candidate");
}
export function getEvolvingCategoryChildren(index: EvolvingCategoryIndex, parentId: string) {
  return [
    ...ENCYCLOPEDIA_CATEGORIES.filter((category) => "parentId" in category && category.parentId === parentId),
    ...index.dynamicNodes.filter((category) =>
      (category.parentId === parentId || category.parentIds?.includes(parentId))
      && category.state !== "candidate"),
  ];
}
export function getEvolvingCategoryPath(index: EvolvingCategoryIndex, id: string) {
  const dynamic = index.dynamicNodes.find((node) => node.id === id && node.state !== "candidate");
  if (!dynamic) return getEncyclopediaCategoryPath(id);
  const path: EncyclopediaCategoryNode[] = [dynamic];
  let parentId = dynamic.parentId;
  const visited = new Set([dynamic.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const dynamicParent = index.dynamicNodes.find((node) => node.id === parentId && node.state !== "candidate");
    if (!dynamicParent) return [...getEncyclopediaCategoryPath(parentId), ...path];
    path.unshift(dynamicParent);
    parentId = dynamicParent.parentId;
  }
  return path;
}
export function getEvolvingArticleCategoryIds(index: EvolvingCategoryIndex, article: ViewableSeedArticle) {
  return index.articleCategoryIds.get(article.slug) ?? getArticleCategoryIds(article);
}
export function articleMatchesEvolvingCategory(index: EvolvingCategoryIndex, article: ViewableSeedArticle, selectedCategoryId: string) {
  return getEvolvingArticleCategoryIds(index, article).some((categoryId) =>
    categoryId === selectedCategoryId
    || isEncyclopediaCategoryOrDescendant(categoryId, selectedCategoryId)
    || getEvolvingCategoryPath(index, categoryId).some((node) => node.id === selectedCategoryId));
}
