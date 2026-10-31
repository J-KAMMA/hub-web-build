import {
  HUBPEDIA_APPROVED_SEED_ARTICLE_SLUGS,
  isApprovedSeedArticleSlug,
} from "@/lib/encyclopedia/publication-manifest";
import { SOURCED_FACTORY_RECORDS } from "./sourced-factory-manifest.generated";
import { UNSOURCED_FACTORY_RECORDS } from "./unsourced-factory-manifest.generated";
import {
  READER_QUALITY_ARTICLES,
  READER_QUALITY_RECENT_SLUGS,
} from "./reader-quality-manifest.generated";
import type { CuratedSeedArticle } from "./types";
import type { FactoryInfoboxRow } from "../factory";
import { keepCommerciallyReusableSources, renderCommercialSourceSection } from "../source-license-policy";
import { canonicalHubpediaSlug, canonicalizeHubpediaLinks, HUBPEDIA_ARTICLE_ALIASES } from "../article-aliases";
import { isReaderReadyArticle } from "../article-quality";
import { UNSOURCED_NOTICE } from "../unsourced-policy";

/*
 * 2026-08-28, by explicit owner decision: every legacy article generation
 * (curated, ai-core-100, second-generation-620, generation 3-7, gold,
 * core-current and their quality batches) was physically removed. The catalog
 * now holds only what the factory produces: source-backed records from
 * sourced-factory-*.bilingual.json and reader-quality upgrades from
 * reader-quality-*.bilingual.json. The layering, link invariant, alias
 * handling, and publication gate are unchanged, so articles rebuilt through
 * the factory flow into the same surfaces the legacy corpus used.
 */

export interface ViewableSeedArticle extends CuratedSeedArticle {
  /* Legacy collection names stay in the type: fixtures and stored records
   * still carry them even though the catalog no longer ships those layers.
   * "factory-unsourced" is deliberately a separate collection rather than a
   * flag: a source-free explanation must never be filed beside an
   * evidence-backed article, and the surfaces select on collection. */
  collection: "curated" | "ai-core-100" | "second-generation-620" | "generation3-100" | "generation4-100" | "generation5-500" | "generation6-luna-30" | "generation7-access-priority" | "gold-batch-01" | "core-current" | "factory-sourced" | "factory-unsourced";
  categoryLabel: string;
  /* Model-written seed: noindex and out of the sitemap until a human approval record exists. */
  aiGenerated?: boolean;
  reviewStatus: "completed" | "review-required" | "sources-required" | "planning-required";
  partNumber?: number;
  priority?: number;
  parentCoreTitle?: string;
  parentCoreSlug?: string;
  translations?: Record<string, { title: string; summary: string; bodyMarkdown: string; infobox?: FactoryInfoboxRow[] }>;
  /* Wikipedia-style fact table, rendered in the article rail when present.
   * Optional: factory batches produced before this field existed carry no
   * infobox and still render fine. */
  infobox?: FactoryInfoboxRow[];
  contentStage?: "stub";
  popularityBasis?: {
    source: string;
    project: string;
    period: string;
    views: number;
  };
}

/* A related-articles list exists to be followed. When the link invariant
 * unwraps an entry that points at an article nobody has written yet, the title
 * stays behind as plain text — a line in a list of links that goes nowhere,
 * and 439 of 967 entries had ended up that way. The reader loses nothing by
 * not being shown it, so the line goes, and the heading with it when no
 * followable entry remains. The demand for the missing article is recorded
 * elsewhere; it does not need to be advertised in the body. */
function dropUnfollowableRelatedEntries(markdown: string) {
  return markdown.replace(
    /^(##\s+(?:関連記事|関連項目|Related articles)\s*)\n\n((?:[-*] .*(?:\n|$))+)/gmu,
    (_section, heading: string, list: string) => {
      const followable = list.split("\n").filter((line) => /^[-*] .*\]\(\/hubpedia\//u.test(line));
      return followable.length ? `${heading}\n\n${followable.join("\n")}\n` : "";
    },
  );
}

function forCommercialPublication<T extends ViewableSeedArticle>(
  article: T,
  claimSourceUrls?: ReadonlyMap<number, string>,
): T {
  const sources = keepCommerciallyReusableSources(article.sources);
  const sourcePositions = new Map(sources.map((source, index) => [source.url, index + 1]));
  /* Infobox rows cite claim indexes; the reader sees the filtered source
   * list, so the citation is renumbered onto the shown source position —
   * the same renumbering the body's [n] markers get. A row whose claim
   * points at a source not shown keeps its fact and drops the marker. */
  const mapInfobox = (rows?: FactoryInfoboxRow[]) => rows?.map((row) => {
    const url = row.cite !== undefined ? claimSourceUrls?.get(row.cite) : undefined;
    const position = url ? sourcePositions.get(url) : undefined;
    return position ? { ...row, cite: position } : { label: row.label, value: row.value };
  });
  const translations = article.translations
    ? Object.fromEntries(Object.entries(article.translations).map(([locale, value]) => [
      locale,
      { ...value, bodyMarkdown: renderCommercialSourceSection(dropUnfollowableRelatedEntries(value.bodyMarkdown), article.sources, claimSourceUrls), infobox: mapInfobox(value.infobox) },
    ]))
    : article.translations;
  return {
    ...article,
    bodyMarkdown: renderCommercialSourceSection(dropUnfollowableRelatedEntries(article.bodyMarkdown), article.sources, claimSourceUrls),
    sources,
    infobox: mapInfobox(article.infobox),
    translations,
  };
}

const readerQualityBySlug = new Map(
  READER_QUALITY_ARTICLES.map((article) => [
    HUBPEDIA_ARTICLE_ALIASES[article.slug] ?? article.slug,
    article,
  ]),
);

/* Source-backed factory batches (sourced-factory-*.bilingual.json). Sources
 * arrive in evidence-policy shape and keep their license metadata so the
 * commercial-reuse filter and the 出典 section work exactly as before.
 * Publication approval still runs through the publication manifest. */
export const FACTORY_SOURCED_ARTICLES: ViewableSeedArticle[] = SOURCED_FACTORY_RECORDS.map((record): ViewableSeedArticle => {
  const qualityUpgrade = readerQualityBySlug.get(record.slug);
  return {
    slug: record.slug,
    canonicalName: qualityUpgrade?.ja.title ?? record.title,
    topicType: record.topicType,
    description: qualityUpgrade?.ja.summary ?? record.summary,
    title: qualityUpgrade?.ja.title ?? record.title,
    summary: qualityUpgrade?.ja.summary ?? record.summary,
    bodyMarkdown: qualityUpgrade?.ja.bodyMarkdown ?? record.bodyMarkdown,
    sources: record.sources.map((source) => ({
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      language: source.language ?? "en",
      reliabilityTier: source.reliabilityTier === "official" || source.reliabilityTier === "primary" ? "primary" : "authoritative",
      license: source.license,
      metadata: { ...source.metadata, planReliabilityTier: source.reliabilityTier, planSourceType: source.sourceType },
    })),
    collection: "factory-sourced",
    categoryLabel: record.categoryLabel,
    reviewStatus: "review-required",
    ...(record.aiGenerated ? { aiGenerated: true } : {}),
    infobox: record.infobox,
    translations: qualityUpgrade ? { en: qualityUpgrade.en } : record.translations,
  };
}).map((article, index) => {
  /* Each claim is numbered by the factory and quoted from one source; the map
   * lets the display renumber the body's markers onto the source list the
   * reader is actually shown. */
  const record = SOURCED_FACTORY_RECORDS[index];
  const claimSourceUrls = new Map(record.provenance.claims.map((claim) => [claim.index, claim.evidence[0].sourceUrl]));
  return forCommercialPublication(article, claimSourceUrls);
});

/* Source-free explanations (unsourced-factory-*.bilingual.json). They carry a
 * notice in the body, sit in their own collection, and are never reader-ready
 * on their own — publication still runs through the manifest, and nothing
 * here can put one in front of a reader as an evidence-backed article. */
export const FACTORY_UNSOURCED_ARTICLES: ViewableSeedArticle[] = UNSOURCED_FACTORY_RECORDS.map((record): ViewableSeedArticle => ({
  slug: record.slug,
  canonicalName: record.title,
  topicType: record.topicType,
  description: record.summary,
  title: record.title,
  summary: record.summary,
  bodyMarkdown: `> ${UNSOURCED_NOTICE.ja}\n\n${record.bodyMarkdown}`,
  sources: [],
  collection: "factory-unsourced",
  categoryLabel: record.categoryLabel,
  reviewStatus: "sources-required",
  translations: record.translations
    ? { en: { ...record.translations.en, bodyMarkdown: `> ${UNSOURCED_NOTICE.en}\n\n${record.translations.en.bodyMarkdown}` } }
    : undefined,
}));

const RESOLVED_SEED_ARTICLES: ViewableSeedArticle[] = [...FACTORY_SOURCED_ARTICLES, ...FACTORY_UNSOURCED_ARTICLES]
  .filter((article) => !HUBPEDIA_ARTICLE_ALIASES[article.slug])
  .map((article) => ({
    ...article,
    bodyMarkdown: canonicalizeHubpediaLinks(article.bodyMarkdown),
    translations: article.translations
      ? Object.fromEntries(Object.entries(article.translations).map(([locale, translation]) => [locale, {
        ...translation,
        bodyMarkdown: canonicalizeHubpediaLinks(translation.bodyMarkdown),
      }]))
      : undefined,
  }));

/* Structural invariant: a reader never meets an internal link to an article
 * that does not exist. Unresolvable links are unwrapped to their anchor text
 * at build time, and the missing targets are exported as demand — each one is
 * an article some author already wanted to reference. */
const resolvedSlugSet = new Set(RESOLVED_SEED_ARTICLES.map((article) => article.slug));
const unresolvedLinkTargets = new Map<string, Set<string>>();
function unwrapMissingInternalLinks(slug: string, markdown: string) {
  return markdown.replace(/\[([^\]]+)\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g, (match, anchor: string, target: string) => {
    if (resolvedSlugSet.has(target)) return match;
    const referrers = unresolvedLinkTargets.get(target) ?? new Set<string>();
    referrers.add(slug);
    unresolvedLinkTargets.set(target, referrers);
    return anchor;
  });
}

export const VIEWABLE_SEED_ARTICLES: ViewableSeedArticle[] = RESOLVED_SEED_ARTICLES.map((article) => ({
  ...article,
  bodyMarkdown: unwrapMissingInternalLinks(article.slug, article.bodyMarkdown),
  translations: article.translations
    ? Object.fromEntries(Object.entries(article.translations).map(([locale, translation]) => [locale, {
      ...translation,
      bodyMarkdown: unwrapMissingInternalLinks(article.slug, translation.bodyMarkdown),
    }]))
    : undefined,
}));

/** Internal-link targets that no article satisfies, with the articles that wanted them. */
export const HUBPEDIA_UNRESOLVED_LINK_TARGETS: ReadonlyArray<{ target: string; referrers: string[] }> = [
  ...unresolvedLinkTargets.entries(),
].map(([target, referrers]) => ({ target, referrers: [...referrers].sort() }))
  .sort((left, right) => right.referrers.length - left.referrers.length || left.target.localeCompare(right.target, "en"));

/* The collection check comes first and does not depend on the quality
 * heuristics: a source-free article can be well written — one passed
 * isReaderReadyArticle and reached this set before the check was added — and
 * being well written is not what makes it fit to sit beside sourced work. */
export const READER_READY_SEED_ARTICLES = VIEWABLE_SEED_ARTICLES
  .filter((article) => article.collection !== "factory-unsourced")
  .filter(isReaderReadyArticle);

/** @deprecated Use HUBPEDIA_APPROVED_SEED_ARTICLE_SLUGS. */
export const HUBPEDIA_PILOT_ARTICLE_SLUGS = HUBPEDIA_APPROVED_SEED_ARTICLE_SLUGS;
/** @deprecated Hubpedia now always uses explicit publication approval. */
export const HUBPEDIA_PILOT_MODE = true;
export function isPublicHubpediaSlug(slug: string) {
  return isApprovedSeedArticleSlug(slug);
}
export const PUBLIC_VIEWABLE_SEED_ARTICLES = VIEWABLE_SEED_ARTICLES.filter((article) =>
  isApprovedSeedArticleSlug(article.slug)
);
export const PUBLIC_READER_READY_SEED_ARTICLES = READER_READY_SEED_ARTICLES.filter((article) =>
  isApprovedSeedArticleSlug(article.slug)
);

export const HUBPEDIA_READER_QUALITY_SLUGS = [
  ...new Set(READER_QUALITY_ARTICLES.map((article) => HUBPEDIA_ARTICLE_ALIASES[article.slug] ?? article.slug)),
];
export const HUBPEDIA_RECENT_PUBLICATION_SLUGS = [
  ...new Set([
    ...FACTORY_SOURCED_ARTICLES.map((article) => article.slug),
    ...READER_QUALITY_RECENT_SLUGS.map((slug) => HUBPEDIA_ARTICLE_ALIASES[slug] ?? slug),
  ]),
];

const publicReaderReadyBySlug = new Map(PUBLIC_READER_READY_SEED_ARTICLES.map((article) => [article.slug, article]));

export const RECENTLY_PUBLISHED_SEED_ARTICLES = HUBPEDIA_RECENT_PUBLICATION_SLUGS
  .map((slug) => publicReaderReadyBySlug.get(canonicalHubpediaSlug(slug)))
  .filter((article): article is ViewableSeedArticle => Boolean(article));

export function getViewableSeedArticle(slug: string) {
  return VIEWABLE_SEED_ARTICLES.find((article) => article.slug === slug) ?? null;
}

export function getPublicSeedArticle(slug: string) {
  return isPublicHubpediaSlug(slug) ? getViewableSeedArticle(slug) : null;
}
