import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

/*
 * Search-engine exposure for Hubpedia (docs/hubpedia-hybrid/DESIGN.md section 7).
 *
 * An entry that no human has reviewed is noindex and stays out of the sitemap.
 * The sister site dopyugaki lost all of its search traffic in the 2026-09 spam
 * update because of mass thin pages; AI-only text must never be offered to
 * crawlers on its own.
 *
 * "Human reviewed" means the revision that is live right now (the current one,
 * approved for publication and passing the 0116 guard) has author_kind 'human'
 * or 'hybrid'. hubpedia_publication_approvals records no reviewer, so an
 * approval of an AI-only revision does not count: author_kind decides.
 * Entries whose knowledge state is disputed or refuted are also kept out.
 */

/** Joined as: encyclopedia_articles a JOIN encyclopedia_article_revisions rev ON rev.id = a.current_revision_id */
const LIVE_CONDITION = `a.status = 'published'
  AND EXISTS (
    SELECT 1 FROM hubpedia_publication_approvals approval
    WHERE approval.article_slug = a.slug AND approval.revoked_at IS NULL
      AND approval.approved_revision_key = 'db:' || rev.revision_number
  )
  AND EXISTS (
    SELECT 1 FROM hubpedia_publication_eligible_articles eligible
    WHERE eligible.article_slug = a.slug AND eligible.revision_id = a.current_revision_id
  )`;

/*
 * A ledger version (docs/hubpedia-ledger.md section 5) is AI-written, so its
 * author_kind stays 'ai'. It counts as human-reviewed only while the current
 * revision has an 'approved' row in hubpedia_revision_reviews. The row is per
 * revision, so the next version is noindex again until a person reviews it.
 */
const HUMAN_REVIEWED_CONDITION = `(
    rev.author_kind IN ('human', 'hybrid')
    OR EXISTS (
      SELECT 1 FROM hubpedia_revision_reviews review
      WHERE review.revision_id = rev.id AND review.verdict = 'approved'
    )
  )`;

/*
 * A ledger stub (a short entry built from few sources, docs/hubpedia-ledger.md stub tier) is never indexed, even when a
 * person has approved it. The flag is in the revision's metadata, so the next, fuller revision lifts it.
 */
const STUB_CONDITION = `(COALESCE(CASE WHEN json_valid(rev.generation_metadata) THEN json_extract(rev.generation_metadata, '$.stub') END, 0) = 1)`;

const INDEXABLE_CONDITION = `${LIVE_CONDITION}
  AND ${HUMAN_REVIEWED_CONDITION}
  AND NOT ${STUB_CONDITION}
  AND NOT EXISTS (
    SELECT 1 FROM hubpedia_article_knowledge_state knowledge
    WHERE knowledge.article_slug = a.slug AND knowledge.knowledge_status IN ('disputed', 'refuted')
  )`;

export const SITEMAP_PAGE_SIZE = 500;
export const SITEMAP_MAX_ARTICLES = 5000;

/** Keyset page over the slug unique index. No OFFSET, no sort step. */
export const INDEXABLE_SLUGS_SQL = `SELECT a.slug AS slug, a.updated_at AS updatedAt
  FROM encyclopedia_articles a
  JOIN encyclopedia_article_revisions rev ON rev.id = a.current_revision_id
  WHERE a.slug > ? AND ${INDEXABLE_CONDITION}
  ORDER BY a.slug
  LIMIT ?`;

export type IndexableArticle = { slug: string; updatedAt: number | null };

export async function listIndexableHubpediaArticles(db: D1Database, options: { after?: string; limit?: number } = {}): Promise<IndexableArticle[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? SITEMAP_PAGE_SIZE), 1), SITEMAP_PAGE_SIZE);
  const rows = await db.prepare(INDEXABLE_SLUGS_SQL).bind(options.after ?? "", limit).all<{ slug: string; updatedAt: number | string | null }>();
  return (rows.results ?? []).map((row) => ({ slug: row.slug, updatedAt: row.updatedAt === null ? null : Number(row.updatedAt) }));
}

/** Every indexable entry, at most SITEMAP_MAX_ARTICLES, read page by page. */
export async function listAllIndexableHubpediaArticles(db: D1Database): Promise<IndexableArticle[]> {
  const all: IndexableArticle[] = [];
  let after = "";
  while (all.length < SITEMAP_MAX_ARTICLES) {
    const page = await listIndexableHubpediaArticles(db, { after, limit: Math.min(SITEMAP_PAGE_SIZE, SITEMAP_MAX_ARTICLES - all.length) });
    all.push(...page);
    if (page.length < SITEMAP_PAGE_SIZE) break;
    after = page[page.length - 1].slug;
  }
  return all;
}

const STATE_SQL = `SELECT
    (${LIVE_CONDITION}) AS live,
    CASE WHEN ${HUMAN_REVIEWED_CONDITION} THEN 1 ELSE 0 END AS humanReviewed,
    CASE WHEN ${STUB_CONDITION} THEN 1 ELSE 0 END AS stub,
    EXISTS (
      SELECT 1 FROM hubpedia_article_knowledge_state knowledge
      WHERE knowledge.article_slug = a.slug AND knowledge.knowledge_status IN ('disputed', 'refuted')
    ) AS disputed
  FROM encyclopedia_articles a
  JOIN encyclopedia_article_revisions rev ON rev.id = a.current_revision_id
  WHERE a.slug = ?
  LIMIT 1`;

export type HubpediaIndexability =
  | { index: true; reason: "human-reviewed" | "curated-seed" }
  | { index: false; reason: "ai-only" | "disputed" | "not-published" | "stub" | "unknown" };

/**
 * Whether the article page may be indexed. Fails closed: any read error or
 * missing entry is noindex. A curated seed article with no live database entry
 * keeps its existing behaviour (indexable).
 */
export async function getHubpediaIndexability(db: D1Database | null, slug: string, hasSeed: boolean, seedAiGenerated = false): Promise<HubpediaIndexability> {
  /* A model-written seed is not a curated seed: without a live human-reviewed
   * database entry it stays noindex. Only the database path can lift it. */
  const seedFallback: HubpediaIndexability = !hasSeed ? { index: false, reason: "unknown" } : seedAiGenerated ? { index: false, reason: "ai-only" } : { index: true, reason: "curated-seed" };
  if (!db) return seedFallback;
  let row: { live: number; humanReviewed: number; disputed: number; stub?: number } | null;
  try {
    row = await db.prepare(STATE_SQL).bind(slug).first<{ live: number; humanReviewed: number; disputed: number; stub?: number }>();
  } catch {
    return seedFallback;
  }
  if (!row || !row.live) return hasSeed ? seedFallback : { index: false, reason: "not-published" };
  if (row.stub) return { index: false, reason: "stub" };
  if (!row.humanReviewed) return { index: false, reason: "ai-only" };
  if (row.disputed) return { index: false, reason: "disputed" };
  return { index: true, reason: "human-reviewed" };
}
