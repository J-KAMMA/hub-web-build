import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import { attachHubEvidence, evaluateHubItem, type HubEvidenceKind } from "@/lib/server/hubpedia-hub-evidence";

/* Applies an approved claim proposal to the claim tables (see hubpedia-claim-proposals.ts). */
class ClaimConflict extends Error {}
export { ClaimConflict };

export type ClaimProposalKind = "add_claim" | "modify_claim" | "add_evidence" | "add_refuting_evidence";

type ClaimProposalRow = {
  id: string;
  kind: ClaimProposalKind;
  claim_id: string | null;
  topic_id: string;
  statement: string | null;
  evidence_kind: "source" | "hub_item" | null;
  source_url: string | null;
  hub_kind: HubEvidenceKind | null;
  hub_item_id: string | null;
};

export type ClaimEffects = {
  statements: ReturnType<D1Database["prepare"]>[];
  after: () => Promise<void>;
};

const nowSeconds = (now: string) => Math.floor(Date.parse(now) / 1000);

/**
 * Called by reviewProposal on approval. Returns the claim-table writes to run in the same
 * batch as the new revision, and a follow-up for the Hub-evidence attach (which does its
 * own writes). Returns null when the proposal is an ordinary article edit.
 */
export async function prepareClaimEffects(db: D1Database, proposalId: string, now: string): Promise<ClaimEffects | null> {
  const row = await db
    .prepare(
      `SELECT id, kind, claim_id, topic_id, statement, evidence_kind, source_url, hub_kind, hub_item_id
       FROM hubpedia_claim_proposals WHERE proposal_id = ?`,
    )
    .bind(proposalId)
    .first<ClaimProposalRow>();
  if (!row) return null;

  const seconds = nowSeconds(now);
  const statements: ReturnType<D1Database["prepare"]>[] = [];
  let claimId = row.claim_id;
  const stance = row.kind === "add_refuting_evidence" ? "refutes" : "supports";

  if (row.evidence_kind === "hub_item" && row.hub_kind && row.hub_item_id) {
    const item = await evaluateHubItem(db, row.hub_kind, row.hub_item_id);
    if (!item.eligible) throw new ClaimConflict(`The cited Hub item is no longer usable as material (${item.reason}).`);
  }

  if (row.kind === "add_claim") {
    claimId = crypto.randomUUID();
    const metadata = JSON.stringify({ origin: "human", proposalId });
    statements.push(
      db
        .prepare(
          `INSERT INTO encyclopedia_claims (id, topic_id, statement, normalized_statement, status, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?)`,
        )
        .bind(claimId, row.topic_id, row.statement, (row.statement ?? "").normalize("NFKC").toLowerCase(), metadata, seconds, seconds),
    );
    statements.push(stateUpsert(db, claimId, "unverified", now));
  } else {
    const claim = await db.prepare("SELECT id FROM encyclopedia_claims WHERE id = ?").bind(claimId).first();
    if (!claim) throw new ClaimConflict("The claim no longer exists.");
    if (row.kind === "modify_claim") {
      statements.push(
        db
          .prepare("UPDATE encyclopedia_claims SET statement = ?, normalized_statement = ?, updated_at = ? WHERE id = ?")
          .bind(row.statement, (row.statement ?? "").normalize("NFKC").toLowerCase(), seconds, claimId),
      );
      // A reworded claim is no longer what the evidence was checked against.
      statements.push(
        db
          .prepare(
            `UPDATE hubpedia_claim_knowledge_state SET knowledge_status = 'provisional', last_checked_at = NULL,
               checked_by = 'human-edit', updated_at = ?
             WHERE claim_id = ? AND knowledge_status IN ('established', 'strong-evidence')`,
          )
          .bind(now, claimId),
      );
    }
  }

  if (row.evidence_kind) {
    statements.push(stateUpsert(db, claimId as string, stance === "refutes" ? "disputed" : "provisional", now));
  }
  statements.push(
    db
      .prepare("UPDATE hubpedia_claim_proposals SET claim_id = ?, applied_at = ? WHERE id = ?")
      .bind(claimId, now, row.id),
  );

  return {
    statements,
    after: async () => {
      if (row.evidence_kind !== "hub_item" || !row.hub_kind || !row.hub_item_id || !claimId) return;
      const result = await attachHubEvidence(db, { claimId, kind: row.hub_kind, itemId: row.hub_item_id, stance }, new Date(now));
      if (!result.ok) {
        await db
          .prepare("INSERT INTO hubpedia_wiki_audit(id, article_key, actor_profile_id, action, target_id, created_at, detail) VALUES (?, NULL, NULL, 'evidence_attach_failed', ?, ?, ?)")
          .bind(crypto.randomUUID(), proposalId, now, result.reason)
          .run();
      }
    },
  };
}

/**
 * Knowledge state for human-supplied evidence. Never promotes above "provisional"; a refutation
 * always makes the claim "disputed" (unless it is already "refuted").
 */
function stateUpsert(db: D1Database, claimId: string, status: "unverified" | "provisional" | "disputed", now: string) {
  return db
    .prepare(
      `INSERT INTO hubpedia_claim_knowledge_state (claim_id, knowledge_status, reproducibility, last_checked_at, checked_by, updated_at)
       VALUES (?, ?, 'unknown', ?, 'human-edit', ?)
       ON CONFLICT(claim_id) DO UPDATE SET
         knowledge_status = CASE
           WHEN excluded.knowledge_status = 'disputed' AND hubpedia_claim_knowledge_state.knowledge_status <> 'refuted' THEN 'disputed'
           WHEN excluded.knowledge_status = 'provisional' AND hubpedia_claim_knowledge_state.knowledge_status = 'unverified' THEN 'provisional'
           ELSE hubpedia_claim_knowledge_state.knowledge_status END,
         last_checked_at = excluded.last_checked_at,
         updated_at = excluded.updated_at`,
    )
    .bind(claimId, status, now, now);
}
