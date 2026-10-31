import type { ViewableSeedArticle } from "./seed";
import type { PublicSeedSnapshot } from "./seed/public-snapshot";
import { loadWorkerData, type WorkerDataEnv } from "../server/worker-data";

/*
 * Historically this module built the public catalog directly from the
 * core-current JSON files. That corpus was removed on 2026-08-28 by explicit
 * owner decision, so the public catalog is now simply the approved subset of
 * the factory-built seed catalog — one source of truth instead of two.
 *
 * Request paths read the approved subset from public-seed.generated.json, which
 * scripts/generate-hubpedia-public-seed.mjs computes from the full catalog at
 * build time (prebuild). Importing the full catalog here put every factory batch
 * into the Worker bundle several times over and broke the 64 MiB size limit.
 * Only type imports from "./seed" are allowed in this file.
 *
 * The snapshot itself is no longer a module import either: it is a static asset
 * read through the ASSETS binding on first use (lib/server/worker-data.ts), so
 * its 1.8 MB do not sit in the Worker script, and are not evaluated by routes
 * that never show the encyclopedia. Every accessor is therefore async; the
 * optional `env` is for callers outside a request (queue jobs) where there is no
 * request context to find the binding in.
 */

export type PublicSeedArticle = ViewableSeedArticle & {
  authoring?: {
    articleType: string;
    articleStatus: string;
    asOf: string;
    lastVerified: string;
    version: string;
    categories: string[];
    tags: string[];
    claims: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
    relations: Array<Record<string, unknown> | string>;
  };
};

type LoadedPublicSeed = {
  readerReady: PublicSeedArticle[];
  recentSlugs: string[];
  bySlug: Map<string, PublicSeedArticle>;
};

function parseSnapshot(value: unknown): LoadedPublicSeed {
  const snapshot = value as Partial<PublicSeedSnapshot> | null;
  if (!snapshot || !Array.isArray(snapshot.articles) || !Array.isArray(snapshot.readerReadyIndexes) || !Array.isArray(snapshot.recentPublicationSlugs)) {
    throw new Error("The public Hubpedia seed snapshot has an unexpected shape.");
  }
  /* Approved articles, reader-ready or not; getPublicSeedArticle has always
   * served any approved viewable article. */
  const viewable = snapshot.articles as unknown as PublicSeedArticle[];
  const bySlug = new Map<string, PublicSeedArticle>();
  /* find() returned the first match, so the first one wins here too. */
  for (const article of viewable) if (!bySlug.has(article.slug)) bySlug.set(article.slug, article);
  return {
    readerReady: snapshot.readerReadyIndexes.map((index) => {
      const article = viewable[index];
      if (!article) throw new Error(`The public Hubpedia seed snapshot points at a missing article (${index}).`);
      return article;
    }),
    recentSlugs: snapshot.recentPublicationSlugs,
    bySlug,
  };
}

function loadPublicSeed(env?: WorkerDataEnv | null) {
  return loadWorkerData("hubpedia-public-seed", parseSnapshot, env);
}

export async function getPublicReaderReadySeedArticles(env?: WorkerDataEnv | null): Promise<PublicSeedArticle[]> {
  return (await loadPublicSeed(env)).readerReady;
}

export async function getHubpediaRecentPublicationSlugs(env?: WorkerDataEnv | null): Promise<string[]> {
  return (await loadPublicSeed(env)).recentSlugs;
}

export async function getPublicSeedArticle(slug: string, env?: WorkerDataEnv | null): Promise<PublicSeedArticle | null> {
  return (await loadPublicSeed(env)).bySlug.get(slug) ?? null;
}
