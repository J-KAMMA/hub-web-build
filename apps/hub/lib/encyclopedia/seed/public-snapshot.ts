import {
  HUBPEDIA_RECENT_PUBLICATION_SLUGS,
  PUBLIC_READER_READY_SEED_ARTICLES,
  PUBLIC_VIEWABLE_SEED_ARTICLES,
  type ViewableSeedArticle,
} from "./index";
import { SOURCED_FACTORY_RECORDS, type SourcedFactoryRecord } from "./sourced-factory-manifest.generated";
import { isApprovedSeedArticleSlug } from "@/lib/encyclopedia/publication-manifest";

/*
 * Build-time only. Never import this module from request-path code.
 *
 * The full factory catalog (every sourced-factory-*.bilingual.json, ~14 MB)
 * was imported by request paths through public-seed.ts, and the bundler copied
 * it into the Worker three times — once per server chunk that reached it and
 * once more through custom-worker.ts. That alone pushed the Hub Worker past
 * Cloudflare's 64 MiB limit. Requests only ever show the approved subset, so
 * the approved subset is computed here, from the same functions that compute
 * it at runtime, and written to public-seed.generated.json (articles) and
 * public-claims.generated.json (claim graph). public-seed.ts and
 * public-claims.ts read those files instead of the catalog.
 *
 * The full-catalog link pass (unwrapping links to articles that do not exist)
 * runs before the subset is taken, so the snapshot keeps exactly the bodies the
 * runtime used to compute.
 */

export type PublicSourcedRecord = Pick<SourcedFactoryRecord, "slug" | "sources" | "provenance">;

export interface PublicSeedSnapshot {
  /** PUBLIC_VIEWABLE_SEED_ARTICLES, in catalog order. */
  articles: ViewableSeedArticle[];
  /** Positions in `articles` that make up PUBLIC_READER_READY_SEED_ARTICLES, in order. */
  readerReadyIndexes: number[];
  /** HUBPEDIA_RECENT_PUBLICATION_SLUGS restricted to public reader-ready slugs, in order. */
  recentPublicationSlugs: string[];
}

export function buildPublicSeedSnapshot(): PublicSeedSnapshot {
  const readerReadyIndexes = PUBLIC_READER_READY_SEED_ARTICLES.map((article) => {
    const index = PUBLIC_VIEWABLE_SEED_ARTICLES.indexOf(article);
    if (index < 0) throw new Error(`Reader-ready article ${article.slug} is missing from the public viewable set.`);
    return index;
  });
  const publicReaderReadySlugs = new Set(PUBLIC_READER_READY_SEED_ARTICLES.map((article) => article.slug));
  return {
    articles: PUBLIC_VIEWABLE_SEED_ARTICLES,
    readerReadyIndexes,
    recentPublicationSlugs: HUBPEDIA_RECENT_PUBLICATION_SLUGS.filter((slug) => publicReaderReadySlugs.has(slug)),
  };
}

/* Claim graph of approved sourced records, in catalog order. Kept in its own
 * file (public-claims.generated.json) because only the MCP claim view reads
 * it; the scheduled worker imports the article snapshot and should not carry
 * the claims as well. */
export function buildPublicClaimRecords(): PublicSourcedRecord[] {
  return SOURCED_FACTORY_RECORDS
    .filter((record) => isApprovedSeedArticleSlug(record.slug))
    .map((record) => ({ slug: record.slug, sources: record.sources, provenance: record.provenance }));
}

export function serializeGeneratedJson(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}
