import type { D1Database } from "@cloudflare/workers-types";
import { checkClaimStatement } from "./claim-hygiene";

import { isSourceHousekeepingQuote, type FactorySourcedRecord } from "../factory-research";
import { assessEvidenceUse } from "../source-license-policy";
import { claimKeyOf, normalizeClaimText, nowSeconds, resolveRootClaim } from "./dedupe";
import { newLedgerRef } from "./extract";

/*
 * Seed import (docs/hubpedia-ledger.md section 7). Lane D.
 *
 * The existing sourced seed records carry provenance claims, each with a
 * quote and a source URL. This module re-checks each quote against the
 * CURRENT chunks of that source (the ones Lane A's ingest stores) and keeps
 * only claims with at least one verbatim, license-allowed quote. Those claims
 * and evidence go into the ledger.
 *
 * It changes no seed text, no manifest, no approved list, no indexability and
 * no seed file. The three owner decisions of section 7 are explicit flags whose
 * only accepted value today is "no-change"; any other value throws until the
 * owner decides and the section is rewritten.
 */

export type SeedDecisionFlags = {
  /** Decision 1: the 120 approved seeds stay indexable as "human-checked". */
  approvedSeeds: "no-change" | "keep-indexable";
  /** Decision 2: unapproved sourced/unsourced seeds. */
  unapprovedSeeds: "no-change" | "noindex-now";
  /** Decision 3: add aiGenerated: true to existing seeds. */
  markAiGenerated: "no-change" | "mark";
};

export const NO_SEED_CHANGE: SeedDecisionFlags = { approvedSeeds: "no-change", unapprovedSeeds: "no-change", markAiGenerated: "no-change" };

export class SeedDecisionPendingError extends Error {
  constructor(public readonly flag: keyof SeedDecisionFlags) {
    super(`Seed migration decision "${flag}" is still an owner decision (docs/hubpedia-ledger.md section 7); only "no-change" is implemented.`);
    this.name = "SeedDecisionPendingError";
  }
}

export function assertNoSeedChange(flags: Partial<SeedDecisionFlags> = {}): SeedDecisionFlags {
  const merged = { ...NO_SEED_CHANGE, ...flags };
  for (const key of Object.keys(NO_SEED_CHANGE) as Array<keyof SeedDecisionFlags>) {
    if (merged[key] !== "no-change") throw new SeedDecisionPendingError(key);
  }
  return merged;
}

/** A current chunk of a source, as stored by the ingest. */
export type LedgerChunk = { id: string; sourceUrl: string; textContent: string };

export type ImportedClaim = {
  statement: string;
  confidence: number;
  seedSlug: string;
  evidence: Array<{ chunkId: string; quote: string; sourceUrl: string }>;
};

export type SeedImportPlan = {
  claims: ImportedClaim[];
  droppedClaims: number;
  droppedEvidence: number;
  skippedSources: string[];
};

export interface SeedImportDeps {
  /** Current chunks for a source URL; an empty list when the source is not in the ledger. */
  chunksForSource(url: string): Promise<LedgerChunk[]>;
}

/**
 * Pure re-verification. A source the license policy does not allow, a source
 * with no current chunks, and a quote that is not verbatim in a chunk of its own
 * source contribute nothing; a claim left with no evidence is dropped.
 */
export async function planSeedImport(records: readonly FactorySourcedRecord[], deps: SeedImportDeps, flags: Partial<SeedDecisionFlags> = {}): Promise<SeedImportPlan> {
  assertNoSeedChange(flags);
  const plan: SeedImportPlan = { claims: [], droppedClaims: 0, droppedEvidence: 0, skippedSources: [] };
  const skipped = new Set<string>();
  const chunkCache = new Map<string, LedgerChunk[]>();
  for (const record of records) {
    const allowed = new Map<string, boolean>();
    for (const source of record.sources) {
      const decision = assessEvidenceUse({ license: source.license, url: source.url, sourceType: source.sourceType, reliabilityTier: source.reliabilityTier, metadata: source.metadata });
      allowed.set(source.url, decision.allowed);
      if (!decision.allowed) skipped.add(source.url);
    }
    for (const claim of record.provenance.claims) {
      const kept: ImportedClaim["evidence"] = [];
      for (const item of claim.evidence) {
        if (allowed.get(item.sourceUrl) !== true || isSourceHousekeepingQuote(item.quote)) { plan.droppedEvidence += 1; continue; }
        let chunks = chunkCache.get(item.sourceUrl);
        if (!chunks) { chunks = await deps.chunksForSource(item.sourceUrl); chunkCache.set(item.sourceUrl, chunks); }
        const hit = chunks.find((chunk) => chunk.textContent.includes(item.quote));
        if (hit) kept.push({ chunkId: hit.id, quote: item.quote, sourceUrl: item.sourceUrl });
        else plan.droppedEvidence += 1;
      }
      const hygiene = checkClaimStatement(claim.statement);
      if (kept.length === 0 || !hygiene.ok) { plan.droppedClaims += 1; continue; }
      plan.claims.push({ statement: hygiene.statement, confidence: claim.confidence, seedSlug: record.slug, evidence: kept });
    }
  }
  plan.skippedSources = [...skipped].sort();
  return plan;
}

export type SeedImportWrite = { claimsInserted: number; claimsExisting: number; evidenceInserted: number };

/**
 * Writes the plan under the ledger pool topic. Idempotent: a claim is the same
 * when the ledger topic already holds that normalized statement, and evidence is
 * keyed by (claim_id, chunk_id). Only claims and evidence are touched; no seed
 * table, article or indexability row is written.
 */
export async function writeSeedImport(db: D1Database, plan: SeedImportPlan, options: { ledgerTopicId: string; now?: number; newId?: () => string }): Promise<SeedImportWrite> {
  const now = options.now ?? nowSeconds(); // seconds, like every other ledger writer
  const newId = options.newId ?? (() => crypto.randomUUID());
  const result: SeedImportWrite = { claimsInserted: 0, claimsExisting: 0, evidenceInserted: 0 };
  for (const claim of plan.claims) {
    /* Identity is Lane B's claim_key, so a seed claim and an extracted claim with the same text are one row. */
    const normalized = normalizeClaimText(claim.statement);
    const claimKey = claimKeyOf(claim.statement);
    const keyed = await db.prepare("SELECT id FROM encyclopedia_claims WHERE claim_key = ?").bind(claimKey).first<{ id: string }>();
    const existing = keyed ? { id: await resolveRootClaim(db, keyed.id) } : null;
    const claimId = existing?.id ?? newId();
    const statements = [] as ReturnType<D1Database["prepare"]>[];
    if (existing) result.claimsExisting += 1;
    else {
      result.claimsInserted += 1;
      statements.push(db.prepare(`INSERT INTO encyclopedia_claims(id, topic_id, statement, normalized_statement, status, confidence, metadata, created_at, updated_at, claim_key, ledger_ref)
        VALUES(?, ?, ?, ?, 'supported', ?, ?, ?, ?, ?, ?)`).bind(claimId, options.ledgerTopicId, claim.statement, normalized, Math.min(Math.max(claim.confidence, 0), 1), JSON.stringify({ importedFromSeed: claim.seedSlug }), now, now, claimKey, newLedgerRef()));
    }
    for (const item of claim.evidence) {
      statements.push(db.prepare(`INSERT OR IGNORE INTO encyclopedia_claim_evidence(claim_id, chunk_id, stance, quote, relevance, metadata, created_at)
        VALUES(?, ?, 'supports', ?, NULL, '{}', ?)`).bind(claimId, item.chunkId, item.quote, now));
    }
    const batchResult = await db.batch(statements);
    for (const [index, entry] of batchResult.entries()) {
      const isEvidence = existing ? true : index > 0;
      if (isEvidence && (entry.meta?.changes ?? 0) > 0) result.evidenceInserted += 1;
    }
  }
  return result;
}
