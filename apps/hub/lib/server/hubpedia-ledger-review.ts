import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

/*
 * Human approval of a ledger revision (docs/hubpedia-ledger.md section 5, S12).
 *
 * Approving writes one hubpedia_revision_reviews row and, in the same D1 batch,
 * closes the 'ai_generated_requires_review' finding, publishes the article and
 * writes the hubpedia_publication_approvals row. The 0116 trigger runs on that
 * insert, so a revision with no supporting evidence aborts the whole batch and
 * nothing is written. Only an active patrol member or the owner may approve.
 * This module never decides indexability: hubpedia-search-exposure does, from
 * the review row.
 */

export type LedgerReviewVerdict = "approved" | "rejected";

export type LedgerReviewInput = {
  revisionId: string;
  reviewerProfileId: string;
  /** The caller has already established that this profile is the owner. */
  reviewerIsOwner?: boolean;
  verdict: LedgerReviewVerdict;
  /** What the reviewer actually checked, for example { "claims": "sampled 10", "wording": true }. */
  scope?: Record<string, unknown>;
  now?: Date;
};

export type LedgerReviewResult =
  | { ok: true; revisionId: string; verdict: LedgerReviewVerdict; slug: string }
  | { ok: false; reason: "not-authorized" | "revision-not-found" | "not-current-revision" | "already-reviewed" | "not-eligible" | "invalid-scope" };

export const LEDGER_POLICY_VERSION = "ledger-review-v1";

type RevisionRow = { revisionId: string; revisionNumber: number; articleId: string; slug: string; currentRevisionId: string | null; status: string };

async function isActivePatrol(db: D1Database, profileId: string) {
  const row = await db.prepare("SELECT 1 AS ok FROM hubpedia_wiki_patrol WHERE profile_id = ? AND revoked_at IS NULL").bind(profileId).first<{ ok: number }>();
  return row !== null;
}

export async function canReviewLedgerRevision(db: D1Database, profileId: string, isOwner = false) {
  return isOwner || (await isActivePatrol(db, profileId));
}

export async function reviewLedgerRevision(db: D1Database, input: LedgerReviewInput): Promise<LedgerReviewResult> {
  if (!(await canReviewLedgerRevision(db, input.reviewerProfileId, input.reviewerIsOwner === true))) return { ok: false, reason: "not-authorized" };

  let scopeJson: string;
  try {
    scopeJson = JSON.stringify(input.scope ?? {});
    if (scopeJson.length > 4000) return { ok: false, reason: "invalid-scope" };
  } catch {
    return { ok: false, reason: "invalid-scope" };
  }

  const revision = await db.prepare(`SELECT rev.id AS revisionId, rev.revision_number AS revisionNumber, a.id AS articleId, a.slug AS slug,
      a.current_revision_id AS currentRevisionId, a.status AS status
    FROM encyclopedia_article_revisions rev
    JOIN encyclopedia_articles a ON a.id = rev.article_id
    WHERE rev.id = ?`).bind(input.revisionId).first<RevisionRow>();
  if (!revision) return { ok: false, reason: "revision-not-found" };
  if (revision.currentRevisionId !== revision.revisionId) return { ok: false, reason: "not-current-revision" };

  const existing = await db.prepare("SELECT 1 AS ok FROM hubpedia_revision_reviews WHERE revision_id = ?").bind(revision.revisionId).first<{ ok: number }>();
  if (existing) return { ok: false, reason: "already-reviewed" };

  const now = input.now ?? new Date();
  const iso = now.toISOString();
  const review = db.prepare("INSERT INTO hubpedia_revision_reviews(revision_id, reviewer_profile_id, verdict, scope_json, reviewed_at) VALUES(?, ?, ?, ?, ?)")
    .bind(revision.revisionId, input.reviewerProfileId, input.verdict, scopeJson, iso);

  if (input.verdict === "rejected") {
    await db.batch([review]);
    return { ok: true, revisionId: revision.revisionId, verdict: "rejected", slug: revision.slug };
  }

  try {
    await db.batch([
      db.prepare(`UPDATE encyclopedia_review_findings SET status = 'resolved', resolved_at = ?, updated_at = ?
        WHERE revision_id = ? AND finding_type = 'ai_generated_requires_review' AND status = 'open'`).bind(now.getTime(), now.getTime(), revision.revisionId),
      /* A ledger article is stored as a draft; approval is what publishes it. An archived article stays archived. */
      db.prepare("UPDATE encyclopedia_articles SET status = 'published', updated_at = ? WHERE id = ? AND status IN ('draft', 'published')").bind(now.getTime(), revision.articleId),
      /* The 0116 trigger aborts here, and so rolls back the batch, when no supported claim has supporting evidence. */
      db.prepare(`INSERT INTO hubpedia_publication_approvals(article_slug, policy_version, approved_revision_key, approved_at, revoked_at)
        VALUES(?, ?, ?, ?, NULL)
        ON CONFLICT(article_slug) DO UPDATE SET policy_version = excluded.policy_version,
          approved_revision_key = excluded.approved_revision_key, approved_at = excluded.approved_at, revoked_at = NULL`)
        .bind(revision.slug, LEDGER_POLICY_VERSION, `db:${revision.revisionNumber}`, iso),
      review,
    ]);
  } catch {
    return { ok: false, reason: "not-eligible" };
  }
  return { ok: true, revisionId: revision.revisionId, verdict: "approved", slug: revision.slug };
}
