import { ENCYCLOPEDIA_CATEGORIES, getArticleCategoryIds } from "./categories";

/*
 * The structure engine measures the encyclopedia as a whole — the link graph,
 * the category balance, and the demand for articles that do not exist yet —
 * and turns the weak spots into queues the factory can consume. It reads the
 * same catalog readers see, so its numbers are the numbers that matter.
 */

export interface StructureArticleInput {
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  topicType: string;
  categoryLabel?: string;
  description?: string;
}

export interface StructureReport {
  articleCount: number;
  graph: {
    averageOutboundLinks: number;
    orphanSlugs: string[];
    deadEndSlugs: string[];
    componentCount: number;
    largestComponentShare: number;
    isolatedSlugs: string[];
    topHubs: Array<{ slug: string; inbound: number }>;
  };
  categories: {
    distribution: Array<{ categoryId: string; count: number }>;
    uncategorizedSlugs: string[];
    singleCategoryShare: number;
    topCategoryShare: number;
    underCoveredLeafCategories: Array<{ categoryId: string; count: number }>;
  };
  demand: {
    missingLinkTargets: Array<{ target: string; referrers: string[] }>;
  };
}

const internalLink = /\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g;

class UnionFind {
  private parent = new Map<string, string>();
  add(node: string) { if (!this.parent.has(node)) this.parent.set(node, node); }
  find(node: string): string {
    let root = node;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cursor = node;
    while (this.parent.get(cursor) !== root) { const next = this.parent.get(cursor)!; this.parent.set(cursor, root); cursor = next; }
    return root;
  }
  union(left: string, right: string) {
    const a = this.find(left), b = this.find(right);
    if (a !== b) this.parent.set(a, b);
  }
}

export function buildStructureReport(
  articles: readonly StructureArticleInput[],
  unresolvedLinkTargets: ReadonlyArray<{ target: string; referrers: string[] }> = [],
  options: { underCoverageThreshold?: number; topHubCount?: number } = {},
): StructureReport {
  const underCoverageThreshold = options.underCoverageThreshold ?? 10;
  const topHubCount = options.topHubCount ?? 10;
  const slugs = new Set(articles.map((article) => article.slug));
  const inbound = new Map<string, number>(articles.map((article) => [article.slug, 0]));
  const graphComponents = new UnionFind();
  for (const slug of slugs) graphComponents.add(slug);
  let outboundTotal = 0;
  const deadEndSlugs: string[] = [];
  for (const article of articles) {
    let outbound = 0;
    for (const match of article.bodyMarkdown.matchAll(internalLink)) {
      const target = match[1];
      if (!slugs.has(target) || target === article.slug) continue;
      outbound += 1;
      inbound.set(target, (inbound.get(target) ?? 0) + 1);
      graphComponents.union(article.slug, target);
    }
    outboundTotal += outbound;
    if (outbound === 0) deadEndSlugs.push(article.slug);
  }
  const orphanSlugs = articles.filter((article) => (inbound.get(article.slug) ?? 0) === 0).map((article) => article.slug);
  const componentSizes = new Map<string, number>();
  for (const slug of slugs) {
    const root = graphComponents.find(slug);
    componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1);
  }
  const sizes = [...componentSizes.values()].sort((left, right) => right - left);
  const isolatedRoots = new Set([...componentSizes.entries()].filter(([, size]) => size === 1).map(([root]) => root));
  const isolatedSlugs = [...slugs].filter((slug) => isolatedRoots.has(graphComponents.find(slug))).sort();
  const topHubs = [...inbound.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))
    .slice(0, topHubCount)
    .map(([slug, count]) => ({ slug, inbound: count }));

  const categoryCounts = new Map<string, number>();
  const uncategorizedSlugs: string[] = [];
  let singleCategoryCount = 0;
  for (const article of articles) {
    const ids = getArticleCategoryIds(article);
    if (ids.includes("maintenance/uncategorized")) uncategorizedSlugs.push(article.slug);
    if (ids.length === 1) singleCategoryCount += 1;
    for (const id of ids) categoryCounts.set(id, (categoryCounts.get(id) ?? 0) + 1);
  }
  const distribution = [...categoryCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))
    .map(([categoryId, count]) => ({ categoryId, count }));
  const leafCategoryIds = ENCYCLOPEDIA_CATEGORIES
    .filter((category) => "parentId" in category && !("hidden" in category && category.hidden))
    .map((category) => category.id);
  const underCoveredLeafCategories = leafCategoryIds
    .map((categoryId) => ({ categoryId, count: categoryCounts.get(categoryId) ?? 0 }))
    .filter((entry) => entry.count < underCoverageThreshold)
    .sort((left, right) => left.count - right.count || left.categoryId.localeCompare(right.categoryId, "en"));

  return {
    articleCount: articles.length,
    graph: {
      averageOutboundLinks: articles.length ? Number((outboundTotal / articles.length).toFixed(2)) : 0,
      orphanSlugs: orphanSlugs.sort(),
      deadEndSlugs: deadEndSlugs.sort(),
      componentCount: componentSizes.size,
      largestComponentShare: slugs.size ? Number(((sizes[0] ?? 0) / slugs.size).toFixed(3)) : 0,
      isolatedSlugs,
      topHubs,
    },
    categories: {
      distribution,
      uncategorizedSlugs: uncategorizedSlugs.sort(),
      singleCategoryShare: articles.length ? Number((singleCategoryCount / articles.length).toFixed(3)) : 0,
      topCategoryShare: articles.length ? Number(((distribution[0]?.count ?? 0) / articles.length).toFixed(3)) : 0,
      underCoveredLeafCategories,
    },
    demand: {
      missingLinkTargets: [...unresolvedLinkTargets],
    },
  };
}

/* Which articles could this one honestly link to? Two articles are candidates
 * for each other when they share a category. The internal-link rule uses this
 * so it demands links only where a meaningful one exists — an article on
 * genomics in a catalog of planets has nowhere to point, and forcing it to
 * point somewhere buys a bad link rather than a connected encyclopedia. */
export function buildRelatedSlugIndex(
  articles: readonly StructureArticleInput[],
): Map<string, Set<string>> {
  const byCategory = new Map<string, string[]>();
  const categoriesBySlug = new Map<string, string[]>();
  for (const article of articles) {
    const ids = getArticleCategoryIds(article).filter((id) => id !== "maintenance/uncategorized");
    categoriesBySlug.set(article.slug, ids);
    for (const id of ids) byCategory.set(id, [...(byCategory.get(id) ?? []), article.slug]);
  }
  const index = new Map<string, Set<string>>();
  for (const article of articles) {
    const siblings = new Set<string>();
    for (const id of categoriesBySlug.get(article.slug) ?? []) {
      for (const slug of byCategory.get(id) ?? []) if (slug !== article.slug) siblings.add(slug);
    }
    index.set(article.slug, siblings);
  }
  return index;
}

/* The missing-target queue in the exact shape --mode=research consumes: a
 * research-plan skeleton whose sources the curator fills in and reviews. */
export function buildMissingArticlePlanSkeleton(
  missingLinkTargets: ReadonlyArray<{ target: string; referrers: string[] }>,
  limit = 20,
) {
  return {
    version: 1 as const,
    topics: missingLinkTargets.slice(0, limit).map((entry) => ({
      slug: entry.target,
      title: entry.target,
      description: `既存記事からの参照 ${entry.referrers.length} 件: ${entry.referrers.slice(0, 8).join(", ")}. 題名と出典を確認して差し替える。`,
      topicType: "concept",
      categoryLabel: "未定",
      sources: [],
    })),
  };
}
