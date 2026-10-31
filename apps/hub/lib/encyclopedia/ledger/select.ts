import type { D1Database } from "@cloudflare/workers-types";

import { HUBPEDIA_ARTICLE_ALIASES, canonicalHubpediaSlug } from "../article-aliases";
import { HUBPEDIA_APPROVED_SEED_ARTICLE_SLUGS } from "../publication-manifest";
import type { LedgerObjectStore } from "./object-store";
import { hydrateClaims, type LedgerClaimRow } from "./store";
import { evaluateClaim, type LedgerClaim } from "./sentence-check";

/*
 * S7: which topics become articles. The ledger decides from
 * hubpedia_ledger_topic_stats, never by counting on the spot, and it walks the
 * eligible rows by key range (no OFFSET) so an interrupted run resumes where
 * it stopped.
 */

/** `stub` is true for a topic that fails the full gate and is composed as a short noindex stub (see evaluateLedgerGate). */
export type LedgerTopic = { id: string; slug: string; canonicalName: string; stub?: boolean };

const approvedSlugs: ReadonlySet<string> = new Set(HUBPEDIA_APPROVED_SEED_ARTICLE_SLUGS);

/**
 * A slug the ledger must leave alone: a person-approved seed article, an alias of anything, or the target of an alias
 * whose article is approved. A human-seen page is never overwritten by a ledger version.
 */
export function isProtectedSlug(slug: string): boolean {
  if (approvedSlugs.has(slug)) return true;
  if (Object.prototype.hasOwnProperty.call(HUBPEDIA_ARTICLE_ALIASES, slug)) return true;
  const canonical = canonicalHubpediaSlug(slug);
  return approvedSlugs.has(canonical);
}

const TOPIC_COLUMNS = `t.id AS id, t.slug AS slug, t.canonical_name AS canonicalName, cr.created_by AS currentAuthor, a.current_revision_id AS currentRevisionId, s.eligible AS fullEligible`;
const TOPIC_JOINS = `JOIN encyclopedia_topics t ON t.id = s.topic_id
         LEFT JOIN encyclopedia_articles a ON a.topic_id = t.id
         LEFT JOIN encyclopedia_article_revisions cr ON cr.id = a.current_revision_id`;

type TopicRow = { id: string; slug: string; canonicalName: string; currentAuthor: string | null; currentRevisionId: string | null; fullEligible: number; rank?: number | null };

/**
 * Cursor forms: `r:<priority_rank>:<topic_id>` while walking the term net, `t:<topic_id>` afterwards. A bare id is the
 * old form and means the second phase. Empty or undefined starts at the top of the net.
 */
export function parseSelectCursor(cursor: string | undefined): { phase: "net"; rank: number; id: string } | { phase: "rest"; id: string } {
  if (cursor?.startsWith("r:")) {
    const [, rank, ...id] = cursor.split(":");
    return { phase: "net", rank: Number(rank), id: id.join(":") };
  }
  if (cursor?.startsWith("t:")) return { phase: "rest", id: cursor.slice(2) };
  if (cursor) return { phase: "rest", id: cursor };
  return { phase: "net", rank: 0, id: "" };
}

/**
 * Next batch of eligible topics. Order (docs/hubpedia-ledger.md section 4): topics that are terms of the net, by
 * (priority_rank, topic_id); then the topics the net does not know, by topic_id. Both walk a key range, never OFFSET,
 * so an interrupted run resumes at the cursor. Topics whose article is currently owned by a person (current revision
 * not written by the ledger) are skipped here too, so the cursor never stalls on them.
 */
export async function selectEligibleTopics(
  db: D1Database,
  options: { afterTopicId?: string; limit?: number; includeStubs?: boolean } = {},
): Promise<{ topics: LedgerTopic[]; nextCursor: string | null; skippedProtected: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 200);
  /* Stubs are opt-in: a caller that cannot compose and mark a stub must not receive one. */
  const tier = options.includeStubs ? "(s.eligible = 1 OR s.stub_eligible = 1)" : "s.eligible = 1";
  const topics: LedgerTopic[] = [];
  let skippedProtected = 0;
  let position = parseSelectCursor(options.afterTopicId);
  let nextCursor: string | null = null;

  while (topics.length < limit && nextCursor === null) {
    const page = position.phase === "net"
      ? await db.prepare(
        `SELECT ${TOPIC_COLUMNS}, ht.priority_rank AS rank
           FROM hubpedia_terms ht
           JOIN hubpedia_ledger_topic_stats s ON s.topic_id = ht.topic_id AND ${tier}
           ${TOPIC_JOINS}
          WHERE ht.priority_rank IS NOT NULL AND ht.topic_id IS NOT NULL AND t.topic_type <> 'ledger-pool'
            AND NOT (ht.linkable = 0 AND ht.hops > 0)
            AND (ht.priority_rank, ht.topic_id) > (?, ?)
          ORDER BY ht.priority_rank, ht.topic_id
          LIMIT ?`,
      ).bind(position.rank, position.id, limit * 2).all<TopicRow>()
      : await db.prepare(
        `SELECT ${TOPIC_COLUMNS}
           FROM hubpedia_ledger_topic_stats s
           ${TOPIC_JOINS}
          WHERE ${tier} AND s.topic_id > ? AND t.topic_type <> 'ledger-pool'
            AND NOT EXISTS (SELECT 1 FROM hubpedia_terms ht WHERE ht.topic_id = s.topic_id AND (ht.priority_rank IS NOT NULL OR (ht.linkable = 0 AND ht.hops > 0)))
          ORDER BY s.topic_id
          LIMIT ?`,
      ).bind(position.id, limit * 2).all<TopicRow>();
    const rows = page.results ?? [];
    const pageFull = rows.length >= limit * 2;
    for (const row of rows) {
      position = position.phase === "net" ? { phase: "net", rank: Number(row.rank ?? 0), id: row.id } : { phase: "rest", id: row.id };
      const humanOwned = row.currentRevisionId !== null && row.currentAuthor !== "hubpedia-ledger";
      if (isProtectedSlug(row.slug) || humanOwned) { skippedProtected += 1; continue; }
      topics.push({ id: row.id, slug: row.slug, canonicalName: row.canonicalName, ...(options.includeStubs ? { stub: Number(row.fullEligible) !== 1 } : {}) });
      if (topics.length >= limit) { nextCursor = position.phase === "net" ? `r:${position.rank}:${position.id}` : `t:${position.id}`; break; }
    }
    if (nextCursor === null && !pageFull) {
      if (position.phase === "net") position = { phase: "rest", id: "" };
      else break; // both phases exhausted
    }
  }
  if (nextCursor === null && topics.length >= limit) nextCursor = position.phase === "net" ? `r:${position.rank}:${position.id}` : `t:${position.id}`;
  return { topics, nextCursor, skippedProtected };
}

/** All ledger claims attached to a topic with their evidence, usable or not (the checker decides). */
export async function loadTopicClaims(db: D1Database, topicId: string, limit = 400, objects?: LedgerObjectStore): Promise<LedgerClaim[]> {
  const result = await db.prepare(
    `SELECT c.id AS id, c.ledger_ref AS ledgerRef, c.statement AS statement, c.status AS status,
            c.merged_into_claim_id AS mergedIntoClaimId, ks.knowledge_status AS knowledgeStatus
       FROM hubpedia_ledger_claim_topics ct
       JOIN encyclopedia_claims c ON c.id = ct.claim_id
       LEFT JOIN hubpedia_claim_knowledge_state ks ON ks.claim_id = c.id
      WHERE ct.topic_id = ? AND c.ledger_ref IS NOT NULL
      ORDER BY ct.relevance DESC, c.ledger_ref
      LIMIT ?`,
  ).bind(topicId, limit).all<LedgerClaimRow>();
  return hydrateClaims(db, result.results ?? [], objects);
}

/** The claims the writer may be given: those that pass rules 3 to 5 right now. */
export function usableClaims(claims: readonly LedgerClaim[]): LedgerClaim[] {
  return claims.filter((claim) => evaluateClaim(claim).ok);
}
