import { getLinkedArticleSlugs, getRelatedSeedArticlesWithReasons } from "./article-relations";
import { assessArticleQuality } from "./article-quality-engine";
import { parseExplanationBlocks } from "./explanation-engine";
import { rankHubpediaArticlesForQuery, scoreHubpediaArticleQuery } from "./hubpedia-search";
import { updateSchedule } from "./publication-operations";
import type { ViewableSeedArticle } from "./seed";
import { getPublicReaderReadySeedArticles } from "./public-seed";
import { getPublicSourcedFactoryRecords } from "./public-claims";
import { assessEvidenceUse } from "./source-license-policy";
import { getInstanceOrigin } from "@/lib/instance-origin";

const MAX_BODY_CHARACTERS = 60_000;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function articleForLocale(article: ViewableSeedArticle, locale: "ja" | "en") {
  const translation = locale === "ja" ? null : article.translations?.[locale];
  return {
    title: translation?.title ?? article.title,
    summary: translation?.summary ?? article.summary,
    bodyMarkdown: translation?.bodyMarkdown ?? article.bodyMarkdown,
    infobox: translation?.infobox ?? article.infobox,
    locale: translation ? locale : "ja",
  };
}

export async function searchMcpArticles(query: string, limit = 8) {
  return (await searchMcpArticleCandidates(query)).slice(0, Math.max(1, Math.min(20, Math.floor(limit))));
}

export async function searchMcpArticleCandidates(query: string) {
  const normalized = query.normalize("NFKC").trim().slice(0, 200);
  if (!normalized) return [];
  const originalFolded=normalized.toLocaleLowerCase("ja").replace(/[\s・_-]+/gu,""),expansions:Record<string,string>={ai:"人工知能",ml:"機械学習",llm:"大規模言語モデル",nlp:"自然言語処理"},lookup=expansions[originalFolded]??normalized,folded=lookup.toLocaleLowerCase("ja").replace(/[\s・_-]+/gu,"");
  const shortLatin=!expansions[originalFolded]&&/^[a-z0-9+.-]{1,3}$/u.test(folded),escaped=folded.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),boundary=shortLatin?new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,`iu`):null;
  const PUBLIC_READER_READY_SEED_ARTICLES = await getPublicReaderReadySeedArticles();
  const candidates=PUBLIC_READER_READY_SEED_ARTICLES.filter((article)=>{const translations=Object.values(article.translations??{}),raw=[article.title,article.summary,...translations.flatMap(item=>[item.title,item.summary])].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("ja"),haystack=raw.replace(/[\s・_-]+/gu,"");return shortLatin?Boolean(boundary?.test(raw)):scoreHubpediaArticleQuery(article,lookup)>0||haystack.includes(folded);});
  return rankHubpediaArticlesForQuery(candidates, lookup)
    .map((article) => ({ slug: article.slug, title: article.title, summary: article.summary, category: article.categoryLabel, score: Math.max(1,scoreHubpediaArticleQuery(article, lookup)), matchMode:expansions[originalFolded]?"alias-expansion":"hybrid-lexical-concept",url: `${getInstanceOrigin()}/hubpedia/${article.slug}` }));
}

export async function getMcpArticle(slug: string, locale: "ja" | "en" = "ja") {
  const article = (await getPublicReaderReadySeedArticles()).find((candidate) => candidate.slug === slug);
  if (!article) return null;
  const localized = articleForLocale(article, locale), quality = assessArticleQuality(article);
  /* The factory's generatedAt is the article's real last-verified date —
   * every claim was audited against its source quote at that moment. Freshness
   * state mirrors the database article path (verified/stale/unverified). */
  const last = (await seedClaimIndex()).sourcedRecordBySlug.get(slug)?.provenance.generatedAt ?? null;
  const schedule = updateSchedule(article, last);
  const freshness = { ...schedule, state: last ? (schedule.overdue ? "stale" as const : "verified" as const) : "unverified" as const };
  const sources = article.sources.map((source, index) => ({ index: index + 1, title: source.title, publisher: source.publisher, url: source.url, license: source.license ?? null, evidenceUse: assessEvidenceUse(source) }));
  /* Infobox rows arrive with cite already renumbered onto the shown source
   * list's index — the same numbering agents see in `sources` above. */
  const infobox = (localized.infobox ?? []).map((row) => ({ label: row.label, value: row.value, sourceIndex: row.cite ?? null }));
  const bodyMarkdown = localized.bodyMarkdown.slice(0, MAX_BODY_CHARACTERS);
  return {
    slug: article.slug, revisionKey: `seed:${article.slug}`, title: localized.title, summary: localized.summary,
    bodyMarkdown, locale: localized.locale, availableLocales: ["ja", ...Object.keys(article.translations ?? {})],
    contentHash: await sha256(`${localized.title}\n${localized.summary}\n${bodyMarkdown}`), quality: { score: quality.score, publishable: quality.publishable, evidenceCoverage: quality.evidenceCoverage },
    freshness, sources, infobox, category: article.categoryLabel, canonicalUrl: `${getInstanceOrigin()}/hubpedia/${article.slug}`,
  };
}

export async function getMcpSection(slug: string, section: string, locale: "ja" | "en" = "ja") {
  const article = await getMcpArticle(slug, locale); if (!article) return null;
  const needle = section.normalize("NFKC").toLocaleLowerCase(locale).trim();
  const blocks = parseExplanationBlocks(article.bodyMarkdown);
  const block = blocks.find((candidate) => candidate.key === needle || candidate.heading.normalize("NFKC").toLocaleLowerCase(locale).includes(needle));
  return block ? { slug, revisionKey: article.revisionKey, contentHash: await sha256(block.bodyMarkdown), ...block, sources: article.sources, freshness: article.freshness } : null;
}

export async function getMcpRelated(slug: string, limit = 8) {
  const PUBLIC_READER_READY_SEED_ARTICLES = await getPublicReaderReadySeedArticles();
  const article = PUBLIC_READER_READY_SEED_ARTICLES.find((candidate) => candidate.slug === slug); if (!article) return null;
  /*
   * Everything is a candidate, because the pre-filter that used to stand here
   * admitted only articles that were linked, shared a topicType or shared a
   * category label — and so threw away exactly the relations the scorer
   * exists to find. 寿司 and 新石器革命 have the strongest concept overlap in
   * the published set (0.180) and match none of those three, so the one real
   * pair was discarded before it could be scored.
   *
   * The cap stays: the scorer intersects concept sets per candidate, which is
   * fine for a few hundred and not for a few hundred thousand. When the
   * corpus outgrows it, the answer is to narrow by concept overlap rather
   * than by these three fields.
   */
  const candidates=[article,...PUBLIC_READER_READY_SEED_ARTICLES.filter((candidate)=>candidate.slug!==slug).slice(0,160)];
  return getRelatedSeedArticlesWithReasons(article, candidates, Math.max(1, Math.min(20, limit))).map(({ article: related, reason, relationType }) => ({ slug: related.slug, title: related.title, summary: related.summary, reason, relationType, url: `${getInstanceOrigin()}/hubpedia/${related.slug}` }));
}

/*
 * Seed records carry the same claim->evidence graph the database articles do
 * (provenance.claims[].evidence[]), but the SQL readers only see rows that
 * were ingested into D1. These helpers serve the identical shape for approved
 * seed articles so an agent's claim view does not depend on which layer the
 * article happens to live in. One row per (claim, evidence quote), matching
 * the join the D1 reader emits.
 */
type SeedClaimIndex = {
  records: Awaited<ReturnType<typeof getPublicSourcedFactoryRecords>>;
  approvedSeedSlugs: Set<string>;
  sourcedRecordBySlug: Map<string, Awaited<ReturnType<typeof getPublicSourcedFactoryRecords>>[number]>;
};
let seedClaimIndexPromise: Promise<SeedClaimIndex> | null = null;

/* Built on the first claim request in an isolate, not at import: the claim graph is a static asset now. */
function seedClaimIndex(): Promise<SeedClaimIndex> {
  seedClaimIndexPromise ??= (async () => {
    const [articles, records] = await Promise.all([getPublicReaderReadySeedArticles(), getPublicSourcedFactoryRecords()]);
    return {
      records,
      approvedSeedSlugs: new Set(articles.map((article) => article.slug)),
      sourcedRecordBySlug: new Map(records.map((record) => [record.slug, record])),
    };
  })();
  seedClaimIndexPromise.catch(() => { seedClaimIndexPromise = null; });
  return seedClaimIndexPromise;
}

export async function getMcpClaims(slug: string) {
  const { approvedSeedSlugs, sourcedRecordBySlug } = await seedClaimIndex();
  if (!approvedSeedSlugs.has(slug)) return null;
  const record = sourcedRecordBySlug.get(slug);
  if (!record) return [];
  return flattenClaims(record, sourceTrustIndex(record));
}

/* Claim-level search: the article index answers "which article covers X",
 * this answers "which sourced statements say X" — the unit an agent quotes
 * when it grounds an answer. Scores statement and evidence text together so
 * Japanese statements still match English evidence and vice versa. */
export async function searchMcpClaims(query: string, limit = 10) {
  const { records, approvedSeedSlugs } = await seedClaimIndex();
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("ja").slice(0, 200);
  if (!normalized) return [];
  const tokens = normalized.split(/[\s・_\-]+/u).filter(Boolean);
  const scored: { score: number; slug: string; claim: ReturnType<typeof flattenClaims>[number] }[] = [];
  for (const record of records) {
    if (!approvedSeedSlugs.has(record.slug)) continue;
    const sourceByUrl = sourceTrustIndex(record);
    for (const claim of flattenClaims(record, sourceByUrl)) {
      const haystack = `${claim.statement} ${claim.quote}`.toLocaleLowerCase("ja");
      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      if (score > 0) scored.push({ score: score + claim.confidence / 100, slug: record.slug, claim });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, Math.floor(limit))))
    .map(({ slug, claim }) => ({ slug, url: `${getInstanceOrigin()}/hubpedia/${slug}`, ...claim }));
}

/*
 * Trust metadata travels with each claim row so an agent can weight "NASA
 * official + public domain + reviewed 2026-08-28" differently from an
 * unreviewed source — the record carries it but the old lookup dropped it.
 */
type SourceTrust = {
  title: string;
  license?: string | null;
  sourceType?: string | null;
  reliabilityTier?: string | null;
  sourceReviewedAt?: string | null;
  commercialReuse?: boolean | null;
};

function sourceTrustIndex(record: SeedClaimIndex["records"][number]): Map<string, SourceTrust> {
  return new Map(record.sources.map((source) => {
    const reuse = (source.metadata as { commercialReuse?: { approved?: boolean; reviewedAt?: string } } | undefined)?.commercialReuse;
    return [source.url, {
      title: source.title,
      license: source.license ?? null,
      sourceType: source.sourceType ?? null,
      reliabilityTier: source.reliabilityTier ?? null,
      sourceReviewedAt: reuse?.reviewedAt ?? null,
      commercialReuse: reuse?.approved ?? null,
    }];
  }));
}

function flattenClaims(record: SeedClaimIndex["records"][number], sourceByUrl: Map<string, SourceTrust>) {
  return record.provenance.claims.flatMap((claim) =>
    claim.evidence.map((evidence) => {
      const source = sourceByUrl.get(evidence.sourceUrl);
      return {
        id: `seed:${record.slug}:${claim.index}`,
        statement: claim.statement,
        status: "asserted" as const,
        confidence: claim.confidence,
        citationIndex: claim.index,
        sectionPath: null,
        stance: "support" as const,
        quote: evidence.quote,
        sourceUrl: evidence.sourceUrl,
        sourceTitle: source?.title ?? null,
        license: source?.license ?? null,
        sourceType: source?.sourceType ?? null,
        reliabilityTier: source?.reliabilityTier ?? null,
        sourceReviewedAt: source?.sourceReviewedAt ?? null,
        commercialReuse: source?.commercialReuse ?? null,
      };
    }),
  );
}

/* Compact catalog for agents that need to enumerate rather than search:
 * slug + title + category is enough to pick a get_article call. */
export async function listMcpSeedArticles(category?: string) {
  const needle = category?.normalize("NFKC").trim();
  return (await getPublicReaderReadySeedArticles())
    .filter((article) => !needle || article.categoryLabel === needle)
    .map((article) => ({ slug: article.slug, title: article.title, category: article.categoryLabel, url: `${getInstanceOrigin()}/hubpedia/${article.slug}` }));
}
