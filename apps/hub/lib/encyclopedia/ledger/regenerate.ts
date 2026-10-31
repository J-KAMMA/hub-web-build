import type { D1Database } from "@cloudflare/workers-types";

import { evaluateLedgerGate, isDistantTopic, isSensitiveLedgerTopic } from "./topics";
import { chunkLocatorColumns, SnapshotReader, type ChunkLocator, type LedgerObjectStore } from "./object-store";

/*
 * Targeted regeneration (docs/hubpedia-ledger.md section 6). Lane D.
 *
 * A cause (changed evidence, a disputed or refuted claim, a merged claim, a
 * revoked source review) queues each article whose CURRENT revision cites the
 * claim; an article queued many times is one row. The queue is then drained:
 *
 *   1. a human-written or human-approved article gets a wiki proposal, never a
 *      new version, and a refuted claim marks it disputed;
 *   2. any other AI article first gets the sentence check re-run on its current
 *      text (no model call); if the evidence floor still holds, the trimmed text
 *      is saved as a new version;
 *   3. only when the floor is broken is the article recomposed, and when even
 *      that lacks claims the article is archived.
 *
 * The sentence check, the version store and the composer belong to Lane C and
 * arrive through RegenDeps; nothing here calls a model.
 */

export type RegenReason =
  | "evidence-moved"
  | "evidence-lost"
  | "claim-disputed"
  | "claim-refuted"
  | "claim-contradicted"
  | "claim-merged"
  | "source-review-revoked";

export type RegenQueueStatus = "pending" | "done" | "failed";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* Current-revision readers of a claim. encyclopedia_revision_claims_claim_idx finds the rows. */
const ARTICLES_OF_CLAIMS_SQL = (count: number) => `SELECT DISTINCT a.id AS articleId
  FROM encyclopedia_revision_claims rc
  JOIN encyclopedia_articles a ON a.current_revision_id = rc.revision_id
  WHERE rc.claim_id IN (${Array.from({ length: count }, () => "?").join(",")})`;

export async function articleIdsCitingClaims(db: D1Database, claimIds: readonly string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const part of chunk([...new Set(claimIds)], 50)) {
    const rows = await db.prepare(ARTICLES_OF_CLAIMS_SQL(part.length)).bind(...part).all<{ articleId: string }>();
    for (const row of rows.results ?? []) ids.add(row.articleId);
  }
  return [...ids].sort();
}

/** Queue every article whose current revision cites one of these claims. Returns the article ids touched. */
export async function enqueueRegenForClaims(db: D1Database, claimIds: readonly string[], reason: RegenReason, now = Date.now()): Promise<string[]> {
  const articles = await articleIdsCitingClaims(db, claimIds);
  for (const articleId of articles) await enqueueRegen(db, articleId, reason, now);
  return articles;
}

export async function enqueueRegen(db: D1Database, articleId: string, reason: RegenReason, now = Date.now()) {
  const row = await db.prepare("SELECT reasons_json AS reasons FROM hubpedia_ledger_regen_queue WHERE article_id = ?").bind(articleId).first<{ reasons: string }>();
  if (!row) {
    await db.prepare("INSERT OR IGNORE INTO hubpedia_ledger_regen_queue(article_id, reasons_json, first_queued_at, attempts, status) VALUES(?, ?, ?, 0, 'pending')")
      .bind(articleId, JSON.stringify([reason]), now).run();
    return;
  }
  const reasons = new Set<string>(JSON.parse(row.reasons) as string[]);
  reasons.add(reason);
  /* A finished or failed row is queued again; the first-queued time keeps the original cause's age. */
  await db.prepare("UPDATE hubpedia_ledger_regen_queue SET reasons_json = ?, status = 'pending' WHERE article_id = ?").bind(JSON.stringify([...reasons].sort()), articleId).run();
}

/** Claims that rest on a source, through their evidence chunks. For a revoked source review. */
export async function claimIdsOfSource(db: D1Database, sourceId: string): Promise<string[]> {
  const rows = await db.prepare(`SELECT DISTINCT e.claim_id AS claimId
    FROM encyclopedia_source_snapshots s
    JOIN encyclopedia_source_chunks c ON c.snapshot_id = s.id
    JOIN encyclopedia_claim_evidence e ON e.chunk_id = c.id
    WHERE s.source_id = ?`).bind(sourceId).all<{ claimId: string }>();
  return (rows.results ?? []).map((row) => row.claimId);
}

/* ------------------------------------------------------------------ */
/* Re-attaching evidence after a snapshot changed (no model call)       */
/* ------------------------------------------------------------------ */

export type ReattachSummary = {
  copiedByHash: number;
  moved: number;
  lost: number;
  demotedClaims: string[];
  queuedArticles: string[];
};

/**
 * `oldSnapshotId` was replaced by `newSnapshotId` (same source). Every live
 * evidence row on an old chunk is carried to the new snapshot: to the chunk with
 * the same content_hash, else to the chunk whose text still contains the quote
 * verbatim. A quote found nowhere is lost. The old rows are stamped
 * superseded_at (never deleted). A claim left with no live supporting evidence
 * returns to 'proposed'. Every claim whose evidence moved or was lost queues its
 * articles. Needs the Lane A columns content_hash and superseded_at.
 */
export async function reattachEvidenceAfterSnapshotChange(
  db: D1Database,
  input: { oldSnapshotId: string; newSnapshotId: string; now?: number; objects?: LedgerObjectStore },
): Promise<ReattachSummary> {
  const now = input.now ?? Date.now();
  // Chunk text is read from the verified snapshot body (object store); a missing or altered body throws and nothing is moved.
  const reader = new SnapshotReader(input.objects);
  const newRows = (await db.prepare(`SELECT ch.id AS id, ${chunkLocatorColumns("ch", "sn")}
      FROM encyclopedia_source_chunks ch JOIN encyclopedia_source_snapshots sn ON sn.id = ch.snapshot_id
     WHERE ch.snapshot_id = ? ORDER BY ch.chunk_index`)
    .bind(input.newSnapshotId).all<{ id: string } & ChunkLocator>()).results ?? [];
  const newChunks: Array<{ id: string; hash: string | null; text: string }> = [];
  for (const row of newRows) newChunks.push({ id: row.id, hash: row.contentHash, text: await reader.chunkText(row) });
  const byHash = new Map<string, string>();
  for (const c of newChunks) if (c.hash && !byHash.has(c.hash)) byHash.set(c.hash, c.id);

  const evidence = (await db.prepare(`SELECT e.claim_id AS claimId, e.chunk_id AS chunkId, e.stance AS stance, e.quote AS quote,
      e.relevance AS relevance, e.metadata AS metadata, c.content_hash AS hash
    FROM encyclopedia_source_chunks c
    JOIN encyclopedia_claim_evidence e ON e.chunk_id = c.id
    WHERE c.snapshot_id = ? AND e.superseded_at IS NULL`).bind(input.oldSnapshotId)
    .all<{ claimId: string; chunkId: string; stance: string; quote: string | null; relevance: number | null; metadata: string; hash: string | null }>()).results ?? [];

  const summary: ReattachSummary = { copiedByHash: 0, moved: 0, lost: 0, demotedClaims: [], queuedArticles: [] };
  const touched = new Set<string>();
  const statements: ReturnType<D1Database["prepare"]>[] = [];
  const insert = "INSERT OR IGNORE INTO encyclopedia_claim_evidence(claim_id, chunk_id, stance, quote, relevance, metadata, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)";

  for (const item of evidence) {
    touched.add(item.claimId);
    let target = item.hash ? byHash.get(item.hash) : undefined;
    if (target) {
      summary.copiedByHash += 1;
    } else if (item.quote) {
      const quote = item.quote;
      target = newChunks.find((c) => c.text.includes(quote))?.id;
      if (target) summary.moved += 1;
    }
    if (!target) summary.lost += 1;
    else statements.push(db.prepare(insert).bind(item.claimId, target, item.stance, item.quote, item.relevance, item.metadata, now));
    statements.push(db.prepare("UPDATE encyclopedia_claim_evidence SET superseded_at = ? WHERE claim_id = ? AND chunk_id = ?").bind(now, item.claimId, item.chunkId));
  }
  for (const part of chunk(statements, 80)) await db.batch(part);

  for (const claimId of touched) {
    const live = await db.prepare("SELECT 1 AS ok FROM encyclopedia_claim_evidence WHERE claim_id = ? AND stance = 'supports' AND superseded_at IS NULL LIMIT 1").bind(claimId).first<{ ok: number }>();
    if (!live) {
      await db.prepare("UPDATE encyclopedia_claims SET status = 'proposed', updated_at = ? WHERE id = ? AND status = 'supported'").bind(now, claimId).run();
      summary.demotedClaims.push(claimId);
    }
  }
  const lostClaims = new Set(summary.demotedClaims);
  const movedClaims = [...touched].filter((id) => !lostClaims.has(id));
  summary.queuedArticles = [
    ...new Set([
      ...(await enqueueRegenForClaims(db, summary.demotedClaims, "evidence-lost", now)),
      ...(await enqueueRegenForClaims(db, movedClaims, "evidence-moved", now)),
    ]),
  ].sort();
  return summary;
}

/* ------------------------------------------------------------------ */
/* Draining the queue                                                   */
/* ------------------------------------------------------------------ */

export type SanitizeResult = {
  bodyMarkdown: string;
  removedSentences: number;
  remainingClaims: number;
  remainingSources: number;
  /** Per source URL, the number of remaining cited claims on it. The gate is applied to this. */
  remainingClaimsPerSource: number[];
};

export interface RegenDeps {
  /** Hub profile that authors wiki proposals and discussion notes. Without one, a human-lane article is left pending. */
  systemProfileId: string | null;
  /** Lane C section 4 sentence check, run on the current text. Must not call a model. */
  sanitize(input: { articleId: string; slug: string; revisionId: string; bodyMarkdown: string }): Promise<SanitizeResult>;
  /** Lane C store: save a trimmed AI version of the article. */
  saveTrimmedRevision(input: { articleId: string; bodyMarkdown: string; reasons: string[]; stub?: boolean }): Promise<void>;
  /** Lane C compose: rebuild from the claim set (the only path that may call a model). */
  recompose(input: { articleId: string; topicId: string; reasons: string[] }): Promise<{ ok: boolean }>;
  now?: () => number;
  newId?: () => string;
}

export type RegenOutcome =
  | { articleId: string; action: "proposal-created"; proposalId: string; markedDisputed: boolean }
  | { articleId: string; action: "trimmed-version-saved"; removedSentences: number }
  | { articleId: string; action: "recomposed" }
  | { articleId: string; action: "archived" }
  | { articleId: string; action: "left-pending"; why: string }
  | { articleId: string; action: "gone" };

type QueueArticle = {
  articleId: string; slug: string; topicId: string; revisionId: string | null; body: string | null; title: string | null; summary: string | null;
  authorKind: string | null; approvedReview: number; reasons: string; metadata: string | null;
};

const NEXT_PENDING_SQL = `SELECT q.article_id AS articleId, a.slug AS slug, a.topic_id AS topicId, rev.id AS revisionId, rev.body_markdown AS body,
    rev.title AS title, rev.summary AS summary, rev.author_kind AS authorKind, q.reasons_json AS reasons, rev.generation_metadata AS metadata,
    EXISTS (SELECT 1 FROM hubpedia_revision_reviews r WHERE r.revision_id = rev.id AND r.verdict = 'approved') AS approvedReview
  FROM hubpedia_ledger_regen_queue q
  JOIN encyclopedia_articles a ON a.id = q.article_id
  LEFT JOIN encyclopedia_article_revisions rev ON rev.id = a.current_revision_id
  WHERE q.status = 'pending' AND q.article_id > ?
  ORDER BY q.article_id
  LIMIT ?`;

async function citesRefutedClaim(db: D1Database, revisionId: string) {
  const row = await db.prepare(`SELECT 1 AS ok FROM encyclopedia_revision_claims rc
    JOIN encyclopedia_claims c ON c.id = rc.claim_id
    LEFT JOIN hubpedia_claim_knowledge_state k ON k.claim_id = c.id
    WHERE rc.revision_id = ? AND (c.status = 'refuted' OR k.knowledge_status IN ('refuted', 'disputed')
      OR EXISTS (SELECT 1 FROM encyclopedia_claim_relations rel WHERE rel.relation_type = 'contradicts' AND (rel.from_claim_id = c.id OR rel.to_claim_id = c.id)))
    LIMIT 1`).bind(revisionId).first<{ ok: number }>();
  return row !== null;
}

async function humanLane(db: D1Database, row: QueueArticle, deps: RegenDeps, reasons: string[], now: number): Promise<RegenOutcome> {
  const profile = deps.systemProfileId;
  if (!profile) return { articleId: row.articleId, action: "left-pending", why: "no-system-profile" };
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const iso = new Date(now).toISOString();
  const articleKey = `encyclopedia:${row.articleId}`;
  const sanitized = await deps.sanitize({ articleId: row.articleId, slug: row.slug, revisionId: row.revisionId as string, bodyMarkdown: row.body as string });
  const proposalId = newId();
  const reasonText = `台帳の根拠が変わりました (${reasons.join(", ")})。根拠を失った文 ${sanitized.removedSentences} 件を除いた案です。`;
  const disputed = await citesRefutedClaim(db, row.revisionId as string);
  const statements = [
    db.prepare(`INSERT OR IGNORE INTO hubpedia_wiki_articles(article_key, source_kind, source_id, slug, created_at, updated_at)
      VALUES(?, 'encyclopedia_article', ?, ?, ?, ?)`).bind(articleKey, row.articleId, row.slug, iso, iso),
    db.prepare(`INSERT INTO hubpedia_wiki_proposals(id, article_key, editor_profile_id, base_revision_id, title, summary, body_markdown, edit_reason,
        source_urls_json, status, requires_manual_approval, created_at, updated_at, risk_level, review_lane)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, '[]', 'pending', 1, ?, ?, 'high', 'human')`)
      .bind(proposalId, articleKey, profile, row.revisionId, row.title ?? row.slug, row.summary ?? "", sanitized.bodyMarkdown, reasonText, iso, iso),
    db.prepare(`INSERT INTO hubpedia_wiki_discussions(id, article_key, author_profile_id, body, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)`).bind(newId(), articleKey, profile, reasonText, iso, iso),
  ];
  if (disputed) {
    statements.push(db.prepare(`INSERT INTO hubpedia_article_knowledge_state(article_slug, article_type, knowledge_status, updated_at)
      VALUES(?, 'general', 'disputed', ?)
      ON CONFLICT(article_slug) DO UPDATE SET knowledge_status = 'disputed', updated_at = excluded.updated_at`).bind(row.slug, iso));
  }
  await db.batch(statements);
  return { articleId: row.articleId, action: "proposal-created", proposalId, markedDisputed: disputed };
}

async function aiLane(db: D1Database, row: QueueArticle, deps: RegenDeps, reasons: string[]): Promise<RegenOutcome> {
  const sanitized = await deps.sanitize({ articleId: row.articleId, slug: row.slug, revisionId: row.revisionId as string, bodyMarkdown: row.body as string });
  /* A stub revision keeps standing while the stub tier holds; a later full pass lifts the flag on the next version. */
  let wasStub = false;
  try { wasStub = (JSON.parse(row.metadata ?? "{}") as { stub?: unknown }).stub === true; } catch { /* unreadable: treated as a full article */ }
  const input = { claims: sanitized.remainingClaims, claimsPerSource: sanitized.remainingClaimsPerSource, distant: await isDistantTopic(db, row.topicId) };
  const full = evaluateLedgerGate(input).holds;
  const stubHolds = wasStub && !full && evaluateLedgerGate({ ...input, sensitive: await isSensitiveLedgerTopic(db, row.topicId) }).stub;
  if (full || stubHolds) {
    /* Nothing was dropped: the current version already stands and needs no new one. */
    if (sanitized.removedSentences === 0) return { articleId: row.articleId, action: "trimmed-version-saved", removedSentences: 0 };
    await deps.saveTrimmedRevision({ articleId: row.articleId, bodyMarkdown: sanitized.bodyMarkdown, reasons, ...(wasStub ? { stub: !full } : {}) });
    return { articleId: row.articleId, action: "trimmed-version-saved", removedSentences: sanitized.removedSentences };
  }
  const rebuilt = await deps.recompose({ articleId: row.articleId, topicId: row.topicId, reasons });
  if (rebuilt.ok) return { articleId: row.articleId, action: "recomposed" };
  /* The topic no longer has enough claims: it goes back to waiting. */
  await db.prepare("UPDATE encyclopedia_articles SET status = 'archived', updated_at = ? WHERE id = ?").bind((deps.now ?? Date.now)(), row.articleId).run();
  return { articleId: row.articleId, action: "archived" };
}

/** Drain up to `limit` pending rows by article id (keyset, no OFFSET). Each row's own failure is recorded and does not stop the rest. */
export async function processRegenQueue(db: D1Database, deps: RegenDeps, options: { limit?: number } = {}): Promise<RegenOutcome[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = (await db.prepare(NEXT_PENDING_SQL).bind("", limit).all<QueueArticle>()).results ?? [];
  const outcomes: RegenOutcome[] = [];
  for (const row of rows) {
    const now = (deps.now ?? Date.now)();
    const reasons = JSON.parse(row.reasons) as string[];
    try {
      if (!row.revisionId || row.body === null) {
        await db.prepare("UPDATE hubpedia_ledger_regen_queue SET status = 'done' WHERE article_id = ?").bind(row.articleId).run();
        outcomes.push({ articleId: row.articleId, action: "gone" });
        continue;
      }
      const humanOwned = row.authorKind === "human" || row.authorKind === "hybrid" || row.approvedReview === 1;
      const outcome = humanOwned ? await humanLane(db, row, deps, reasons, now) : await aiLane(db, row, deps, reasons);
      if (outcome.action === "left-pending") {
        await db.prepare("UPDATE hubpedia_ledger_regen_queue SET attempts = attempts + 1 WHERE article_id = ?").bind(row.articleId).run();
      } else {
        await db.prepare("UPDATE hubpedia_ledger_regen_queue SET status = 'done', attempts = attempts + 1 WHERE article_id = ?").bind(row.articleId).run();
      }
      outcomes.push(outcome);
    } catch (error) {
      await db.prepare("UPDATE hubpedia_ledger_regen_queue SET status = 'failed', attempts = attempts + 1 WHERE article_id = ?").bind(row.articleId).run();
      outcomes.push({ articleId: row.articleId, action: "left-pending", why: error instanceof Error ? error.message.slice(0, 120) : "error" });
    }
  }
  return outcomes;
}
