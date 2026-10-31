import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import { LEDGER_STUB_NOTICE } from "./topics";
import { chunkLocatorColumns, SnapshotReader, type ChunkLocator, type LedgerObjectStore } from "./object-store";
import type { LedgerClaim, LedgerEvidence, LedgerInfoboxRow } from "./sentence-check";

/*
 * S11: storing a composed article, plus the claim loaders that S7-S9 and the
 * reader share. Nothing here publishes. A stored revision is an AI draft
 * (author_kind 'ai', created_by 'hubpedia-ledger') with an open
 * `ai_generated_requires_review` finding, so the 0116 view keeps it out of
 * publication until a person closes that finding.
 */

export const LEDGER_AUTHOR = "hubpedia-ledger";
const CLAIM_BATCH = 40;

/* ---- loading claims with the evidence the checker needs ---- */

export type LedgerClaimRow = {
  id: string;
  ledgerRef: string;
  statement: string;
  status: string;
  mergedIntoClaimId: string | null;
  knowledgeStatus: string | null;
};

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Attaches evidence (with the chunk text for the verbatim re-check) and its source to claim rows. Keyed reads only. */
export async function hydrateClaims(db: D1Database, rows: readonly LedgerClaimRow[], objects?: LedgerObjectStore): Promise<LedgerClaim[]> {
  // The verbatim re-check needs chunk text, which lives in the object store. A missing or altered body throws (fail closed).
  const reader = new SnapshotReader(objects);
  const evidenceByClaim = new Map<string, LedgerEvidence[]>();
  for (let start = 0; start < rows.length; start += CLAIM_BATCH) {
    const ids = rows.slice(start, start + CLAIM_BATCH).map((row) => row.id);
    const result = await db.prepare(
      `SELECT e.claim_id AS claimId, e.chunk_id AS chunkId, e.stance AS stance, e.quote AS quote,
              e.superseded_at AS supersededAt, ${chunkLocatorColumns("ch", "sn")},
              s.url AS url, s.title AS title, s.publisher AS publisher, s.license AS license,
              s.source_type AS sourceType, s.reliability_tier AS reliabilityTier, s.metadata AS metadata
         FROM encyclopedia_claim_evidence e
         JOIN encyclopedia_source_chunks ch ON ch.id = e.chunk_id
         JOIN encyclopedia_source_snapshots sn ON sn.id = ch.snapshot_id
         JOIN encyclopedia_sources s ON s.id = sn.source_id
        WHERE s.is_active = 1 AND e.claim_id IN (${ids.map(() => "?").join(",")})`,
    ).bind(...ids).all<Record<string, unknown>>();
    for (const row of result.results ?? []) {
      const list = evidenceByClaim.get(String(row.claimId)) ?? [];
      list.push({
        chunkId: String(row.chunkId),
        stance: String(row.stance),
        quote: typeof row.quote === "string" ? row.quote : null,
        supersededAt: row.supersededAt === null || row.supersededAt === undefined ? null : Number(row.supersededAt),
        // Superseded evidence never supports a sentence, so its (older) snapshot body is not fetched.
        chunkText: row.supersededAt === null || row.supersededAt === undefined ? await reader.chunkText(row as unknown as ChunkLocator) : null,
        source: {
          url: String(row.url),
          title: typeof row.title === "string" && row.title ? row.title : String(row.url),
          publisher: typeof row.publisher === "string" ? row.publisher : null,
          license: typeof row.license === "string" ? row.license : null,
          sourceType: typeof row.sourceType === "string" ? row.sourceType : null,
          reliabilityTier: typeof row.reliabilityTier === "string" ? row.reliabilityTier : null,
          metadata: parseObject(row.metadata),
        },
      });
      evidenceByClaim.set(String(row.claimId), list);
    }
  }
  return rows.map((row) => ({ ...row, evidence: evidenceByClaim.get(row.id) ?? [] }));
}

/** The claims a revision cites, in citation order. The reader's whole read: one keyed join plus the evidence. */
export async function loadRevisionClaims(db: D1Database, revisionId: string, objects?: LedgerObjectStore): Promise<LedgerClaim[]> {
  const result = await db.prepare(
    `SELECT c.id AS id, c.ledger_ref AS ledgerRef, c.statement AS statement, c.status AS status,
            c.merged_into_claim_id AS mergedIntoClaimId, ks.knowledge_status AS knowledgeStatus
       FROM encyclopedia_revision_claims rc
       JOIN encyclopedia_claims c ON c.id = rc.claim_id
       LEFT JOIN hubpedia_claim_knowledge_state ks ON ks.claim_id = c.id
      WHERE rc.revision_id = ? AND c.ledger_ref IS NOT NULL
      ORDER BY rc.citation_index, c.ledger_ref`,
  ).bind(revisionId).all<LedgerClaimRow>();
  return hydrateClaims(db, result.results ?? [], objects);
}

/* ---- pipeline bookkeeping (counts and model names only; no prompts or responses) ---- */

export async function beginComposeRun(
  db: D1Database,
  input: { topicId: string; composeKey: string; promptVersion: string; now?: Date },
): Promise<{ runId: string; state: "new" | "retry" | "done" }> {
  const seconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const key = `compose:${input.topicId}:${input.composeKey}:${input.promptVersion}`;
  const existing = await db.prepare("SELECT id, status FROM encyclopedia_pipeline_runs WHERE idempotency_key = ?").bind(key).first<{ id: string; status: string }>();
  if (existing) {
    if (existing.status === "succeeded") return { runId: existing.id, state: "done" };
    await db.prepare("UPDATE encyclopedia_pipeline_runs SET status = 'running', attempt = attempt + 1, error = NULL, started_at = ?, updated_at = ? WHERE id = ?")
      .bind(seconds, seconds, existing.id).run();
    return { runId: existing.id, state: "retry" };
  }
  const runId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO encyclopedia_pipeline_runs(id, topic_id, run_type, status, input, idempotency_key, started_at, created_at, updated_at)
     VALUES(?, ?, 'ledger-compose', 'running', ?, ?, ?, ?, ?)`,
  ).bind(runId, input.topicId, JSON.stringify({ composeKey: input.composeKey, promptVersion: input.promptVersion }), key, seconds, seconds, seconds).run();
  return { runId, state: "new" };
}

export async function finishComposeRun(
  db: D1Database,
  runId: string,
  outcome: { status: "succeeded" | "failed" | "cancelled"; output?: Record<string, unknown>; error?: string; now?: Date },
) {
  const seconds = Math.floor((outcome.now ?? new Date()).getTime() / 1000);
  await db.prepare("UPDATE encyclopedia_pipeline_runs SET status = ?, output = ?, error = ?, completed_at = ?, updated_at = ? WHERE id = ?")
    .bind(outcome.status, outcome.output ? JSON.stringify(outcome.output) : null, outcome.error ?? null, seconds, seconds, runId).run();
}

export async function recordAiCall(
  db: D1Database,
  input: { runId: string; provider: string; model: string; purpose: "ledger-compose" | "ledger-translate"; totalTokens: number; status: "succeeded" | "failed"; errorKind?: string; now?: Date },
) {
  const seconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  await db.prepare(
    `INSERT INTO encyclopedia_ai_calls(id, pipeline_run_id, provider, model, purpose, request_metadata, response_metadata, completion_tokens, status, error, started_at, completed_at, created_at)
     VALUES(?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.runId, input.provider, input.model, input.purpose,
    JSON.stringify({ totalTokens: input.totalTokens }), input.totalTokens, input.status,
    input.errorKind ? JSON.stringify({ kind: input.errorKind }) : null, seconds, seconds, seconds,
  ).run();
}

/* ---- the compose_key guard ---- */

export async function findRevisionByComposeKey(db: D1Database, topicId: string, composeKey: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT r.id AS id
       FROM encyclopedia_articles a
       JOIN encyclopedia_article_revisions r ON r.article_id = a.id
      WHERE a.topic_id = ?
        AND CASE WHEN json_valid(r.generation_metadata) THEN json_extract(r.generation_metadata, '$.composeKey') END = ?
      LIMIT 1`,
  ).bind(topicId, composeKey).first<{ id: string }>();
  return row?.id ?? null;
}

/* ---- the article ---- */

const KNOWLEDGE_RANK: Record<string, number> = { refuted: 0, disputed: 1, unverified: 2, provisional: 3, "strong-evidence": 4, established: 5 };
const ARTICLE_KNOWLEDGE: Record<string, string> = {
  refuted: "refuted", disputed: "disputed", unverified: "unverified", provisional: "provisional",
  "strong-evidence": "partially-unresolved", established: "established",
};

/** The weakest knowledge status among the cited claims, mapped onto the article scale. A claim with no state counts as unverified. */
export function weakestKnowledge(claims: readonly Pick<LedgerClaim, "knowledgeStatus">[]): string {
  let weakest = "established";
  for (const claim of claims) {
    const status = claim.knowledgeStatus && claim.knowledgeStatus in KNOWLEDGE_RANK ? claim.knowledgeStatus : "unverified";
    if (KNOWLEDGE_RANK[status] < KNOWLEDGE_RANK[weakest]) weakest = status;
  }
  return ARTICLE_KNOWLEDGE[weakest];
}

export type StoreLedgerArticleInput = {
  topic: { id: string; slug: string };
  title: string;
  summary: string;
  /** Checked body, markers still in place. */
  bodyMarkdown: string;
  infobox: readonly LedgerInfoboxRow[];
  /** Cited claims in citation order. */
  citedClaims: readonly LedgerClaim[];
  composeKey: string;
  promptVersion: string;
  model: string;
  servedBy: string;
  runId: string;
  droppedByRule: Partial<Record<string, number>>;
  quality?: { score: number; publishable: boolean } | null;
  /** A short article from a topic that passed only the stub tier. Stored in the revision's metadata; always noindex. */
  stub?: boolean;
  /** The AIL reviewer's last verdict was FIX: stored as 要確認 (generation_metadata.needsReview), never to be auto-approved. */
  needsReview?: boolean;
  english?: { title: string; summary: string; bodyMarkdown: string } | null;
  now?: Date;
};

export type StoreLedgerArticleResult =
  | { status: "stored"; articleId: string; revisionId: string; revisionNumber: number }
  | { status: "duplicate"; revisionId: string }
  | { status: "skipped"; reason: "human_owned" | "slug_taken" };

export async function storeLedgerArticle(db: D1Database, input: StoreLedgerArticleInput): Promise<StoreLedgerArticleResult> {
  const seconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const stamp = (input.now ?? new Date()).toISOString();

  const duplicate = await findRevisionByComposeKey(db, input.topic.id, input.composeKey);
  if (duplicate) return { status: "duplicate", revisionId: duplicate };

  const article = await db.prepare(
    `SELECT a.id AS id, a.current_revision_id AS currentRevisionId, r.created_by AS createdBy
       FROM encyclopedia_articles a
       LEFT JOIN encyclopedia_article_revisions r ON r.id = a.current_revision_id
      WHERE a.topic_id = ?`,
  ).bind(input.topic.id).first<{ id: string; currentRevisionId: string | null; createdBy: string | null }>();

  /* A page a person wrote or approved is never replaced by the ledger. */
  if (article?.currentRevisionId && article.createdBy !== LEDGER_AUTHOR) return { status: "skipped", reason: "human_owned" };
  if (!article) {
    const taken = await db.prepare("SELECT 1 AS found FROM encyclopedia_articles WHERE slug = ?").bind(input.topic.slug).first();
    if (taken) return { status: "skipped", reason: "slug_taken" };
  }

  const articleId = article?.id ?? crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const latest = article
    ? await db.prepare("SELECT MAX(revision_number) AS latest FROM encyclopedia_article_revisions WHERE article_id = ?").bind(articleId).first<{ latest: number | null }>()
    : null;
  const revisionNumber = (latest?.latest ?? 0) + 1;

  const metadata = JSON.stringify({
    origin: "hubpedia-ledger",
    pipelineRunId: input.runId,
    composeKey: input.composeKey,
    promptVersion: input.promptVersion,
    model: input.model,
    servedBy: input.servedBy,
    reviewRequired: true,
    indexing: "noindex",
    ...(input.stub ? { stub: true, stubNotice: LEDGER_STUB_NOTICE } : {}),
    ...(input.needsReview ? { needsReview: true, reviewLabel: "要確認", autoApprove: false } : {}),
    ledgerRefs: input.citedClaims.map((claim) => claim.ledgerRef),
    droppedByRule: input.droppedByRule,
    infobox: input.infobox,
    quality: input.quality ?? null,
  });

  const statements: D1PreparedStatement[] = [];
  if (!article) {
    statements.push(db.prepare(
      "INSERT INTO encyclopedia_articles(id, topic_id, title, slug, status, created_at, updated_at) VALUES(?, ?, ?, ?, 'draft', ?, ?)",
    ).bind(articleId, input.topic.id, input.title, input.topic.slug, seconds, seconds));
  }
  statements.push(
    db.prepare(
      `INSERT INTO encyclopedia_article_revisions
         (id, article_id, revision_number, title, summary, body_markdown, generation_metadata, created_by, author_kind, contributors_json, ai_run_id, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'ai', '[]', ?, ?)`,
    ).bind(revisionId, articleId, revisionNumber, input.title, input.summary, input.bodyMarkdown, metadata, LEDGER_AUTHOR, input.runId, seconds),
    db.prepare("UPDATE encyclopedia_articles SET current_revision_id = ?, title = ?, updated_at = ? WHERE id = ?").bind(revisionId, input.title, seconds, articleId),
    db.prepare(
      `INSERT INTO encyclopedia_review_findings(id, revision_id, claim_id, finding_type, severity, status, message, location, metadata, created_at, updated_at)
       VALUES(?, ?, NULL, 'ai_generated_requires_review', 'warning', 'open', ?, '{}', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), revisionId, input.needsReview ? "要確認: the AI reviewer asked for fixes (FIX). AI-composed revision must be reviewed before publication." : "AI-composed revision must be reviewed before publication.", JSON.stringify({ pipelineRunId: input.runId }), seconds, seconds),
  );
  input.citedClaims.forEach((claim, position) => {
    statements.push(db.prepare(
      "INSERT INTO encyclopedia_revision_claims(revision_id, claim_id, citation_index, created_at) VALUES(?, ?, ?, ?)",
    ).bind(revisionId, claim.id, position + 1, seconds));
  });
  statements.push(db.prepare(
    `INSERT INTO hubpedia_article_knowledge_state(article_slug, article_type, knowledge_status, reproducibility, last_synthesized_at, ai_generated_ratio, human_review_scope, synthesis_version, updated_at)
     VALUES(?, 'general', ?, 'not-applicable', ?, 1, NULL, ?, ?)
     ON CONFLICT(article_slug) DO UPDATE SET knowledge_status = excluded.knowledge_status, last_synthesized_at = excluded.last_synthesized_at,
       ai_generated_ratio = 1, human_review_scope = NULL, synthesis_version = excluded.synthesis_version, updated_at = excluded.updated_at`,
  ).bind(input.topic.slug, weakestKnowledge(input.citedClaims), stamp, input.promptVersion, stamp));
  if (input.english) {
    statements.push(db.prepare(
      `INSERT INTO encyclopedia_article_translations(id, source_revision_id, locale, title, summary, body_markdown, status, generation_metadata, created_at, updated_at)
       VALUES(?, ?, 'en', ?, ?, ?, 'review', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), revisionId, input.english.title, input.english.summary, input.english.bodyMarkdown, JSON.stringify({ pipelineRunId: input.runId }), seconds, seconds));
  }

  await db.batch(statements);
  return { status: "stored", articleId, revisionId, revisionNumber };
}

/* ---- S6 regeneration: a trimmed version of the current revision (docs/hubpedia-ledger.md section 6) ---- */

/**
 * Saves the already-checked, sentence-trimmed body as a new AI revision of the article. No model is involved. The
 * cited claims are the refs still present in the body; the new revision is an AI draft with an open review finding,
 * like any other ledger revision. Returns null when the article has no current revision.
 */
export async function saveTrimmedRevision(
  db: D1Database,
  input: { articleId: string; bodyMarkdown: string; reasons: readonly string[]; stub?: boolean; now?: Date },
): Promise<{ revisionId: string; revisionNumber: number; citedClaims: number } | null> {
  const seconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const current = await db.prepare(
    `SELECT a.slug AS slug, a.title AS articleTitle, r.id AS revisionId, r.title AS title, r.summary AS summary,
            r.generation_metadata AS metadata, r.ai_run_id AS aiRunId
       FROM encyclopedia_articles a JOIN encyclopedia_article_revisions r ON r.id = a.current_revision_id
      WHERE a.id = ?`,
  ).bind(input.articleId).first<{ slug: string; articleTitle: string; revisionId: string; title: string; summary: string | null; metadata: string | null; aiRunId: string | null }>();
  if (!current) return null;

  const refs: string[] = [];
  for (const match of input.bodyMarkdown.matchAll(/\{c:([^}]+)\}/gu)) {
    for (const ref of match[1].split(",")) if (ref.trim() && !refs.includes(ref.trim())) refs.push(ref.trim());
  }
  const claimIds = new Map<string, string>();
  for (let start = 0; start < refs.length; start += CLAIM_BATCH) {
    const slice = refs.slice(start, start + CLAIM_BATCH);
    const rows = await db.prepare(`SELECT id, ledger_ref AS ledgerRef FROM encyclopedia_claims WHERE ledger_ref IN (${slice.map(() => "?").join(",")})`)
      .bind(...slice).all<{ id: string; ledgerRef: string }>();
    for (const row of rows.results ?? []) claimIds.set(row.ledgerRef, row.id);
  }
  const cited = refs.filter((ref) => claimIds.has(ref));

  const latest = await db.prepare("SELECT MAX(revision_number) AS latest FROM encyclopedia_article_revisions WHERE article_id = ?").bind(input.articleId).first<{ latest: number | null }>();
  const revisionNumber = (latest?.latest ?? 0) + 1;
  const revisionId = crypto.randomUUID();
  const base = parseObject(current.metadata) ?? {};
  /* stub: false lifts the flag (the trimmed version now passes the full gate); undefined keeps whatever the revision had. */
  if (input.stub === false) { delete base.stub; delete base.stubNotice; }
  const metadata = JSON.stringify({ ...base, trimmedFromRevisionId: current.revisionId, trimReasons: input.reasons, ledgerRefs: cited, reviewRequired: true, indexing: "noindex" });

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO encyclopedia_article_revisions
         (id, article_id, revision_number, title, summary, body_markdown, generation_metadata, created_by, author_kind, contributors_json, ai_run_id, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'ai', '[]', ?, ?)`,
    ).bind(revisionId, input.articleId, revisionNumber, current.title, current.summary, input.bodyMarkdown, metadata, LEDGER_AUTHOR, current.aiRunId, seconds),
    db.prepare("UPDATE encyclopedia_articles SET current_revision_id = ?, updated_at = ? WHERE id = ?").bind(revisionId, seconds, input.articleId),
    db.prepare(
      `INSERT INTO encyclopedia_review_findings(id, revision_id, claim_id, finding_type, severity, status, message, location, metadata, created_at, updated_at)
       VALUES(?, ?, NULL, 'ai_generated_requires_review', 'warning', 'open', ?, '{}', '{}', ?, ?)`,
    ).bind(crypto.randomUUID(), revisionId, "AI-trimmed revision must be reviewed before publication.", seconds, seconds),
  ];
  cited.forEach((ref, position) => {
    statements.push(db.prepare("INSERT INTO encyclopedia_revision_claims(revision_id, claim_id, citation_index, created_at) VALUES(?, ?, ?, ?)")
      .bind(revisionId, claimIds.get(ref)!, position + 1, seconds));
  });
  await db.batch(statements);
  return { revisionId, revisionNumber, citedClaims: cited.length };
}

/**
 * Flags the current revision of an article as 要確認 after the fact (the AIL reviewer's last verdict was FIX): the revision's
 * generation_metadata gets needsReview and its open review finding gets the 要確認 message. Idempotent. Returns false when
 * the article or its current revision does not exist.
 */
export async function markRevisionNeedsReview(db: D1Database, slug: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT r.id AS revisionId, r.generation_metadata AS metadata
       FROM encyclopedia_articles a JOIN encyclopedia_article_revisions r ON r.id = a.current_revision_id WHERE a.slug = ?`,
  ).bind(slug).first<{ revisionId: string; metadata: string | null }>();
  if (!row) return false;
  let meta: Record<string, unknown> = {};
  try { meta = row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : {}; } catch { meta = {}; }
  meta.needsReview = true; meta.reviewLabel = "要確認"; meta.autoApprove = false;
  await db.batch([
    db.prepare("UPDATE encyclopedia_article_revisions SET generation_metadata = ? WHERE id = ?").bind(JSON.stringify(meta), row.revisionId),
    db.prepare("UPDATE encyclopedia_review_findings SET message = ? WHERE revision_id = ? AND finding_type = 'ai_generated_requires_review'")
      .bind("要確認: the AI reviewer asked for fixes (FIX). AI-composed revision must be reviewed before publication.", row.revisionId),
  ]);
  return true;
}
