import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { renderArticleMarkdown, type ArticleDraft } from "@/lib/encyclopedia/article-draft";
import { ENCYCLOPEDIA_CATEGORIES, getEncyclopediaCategoryNode } from "@/lib/encyclopedia/categories";
import {
  FACTORY_CLAIM_EXTRACTION_SYSTEM,
  assessEvidenceSufficiency,
  planFactoryClaimJobs,
  planFactorySourcedArticleJob,
  verifyFactoryClaims,
  type FactoryClaimsResponse,
  type FactoryResearchChunk,
  type FactoryResearchTopic,
  type VerifiedFactoryClaim,
} from "@/lib/encyclopedia/factory-research";
import type { HubpediaAiJob } from "@/lib/encyclopedia/llm-batch";
import {
  captureHubItem,
  evaluateHubItem,
  hubItemContentHash,
  limitQuote,
  recomputeClaimKnowledge,
  type HubEvidenceKind,
} from "@/lib/server/hubpedia-hub-evidence";
import {
  HUB_TOPIC_MIN_AUTHORS,
  HUB_TOPIC_MIN_KIND_FAMILIES,
  kindFamily,
} from "@/lib/server/hubpedia-hub-topics";

/*
 * Draft assembly for a Hub topic candidate (docs/hubpedia-hybrid/DESIGN.md,
 * phase 2). The factory's existing steps do the generating (claim extraction,
 * then a cited article); this module supplies what they cannot know:
 *
 *   - the material: each usable Hub item becomes one short "chunk" holding only
 *     its quote (at most 200 characters, the same text the evidence row keeps),
 *     so the model never sees more of a member's writing than Hubpedia stores;
 *   - the check after generation: a claim survives only if its quote is
 *     verbatim in the chunk it names (verifyFactoryClaims, unchanged), and the
 *     surviving claims together still span three authors and two kinds;
 *   - the write: a draft, never public, never indexed, marked as AI-written,
 *     whose claims carry hub_item evidence captured through captureHubItem().
 *
 * No model is called here. Callers hand in the model's parsed output, which is
 * also how the tests drive it without any provider.
 */

export const HUB_TOPIC_EVIDENCE_FLOOR = { minimumClaims: 3, minimumSourcesWithClaims: HUB_TOPIC_MIN_AUTHORS } as const;

export type HubTopicMaterialItem = {
  kind: HubEvidenceKind;
  itemId: string;
  authorProfileId: string;
  quote: string;
  snapshotSha256: string;
  chunk: FactoryResearchChunk;
};

export type HubTopicMaterial = {
  candidateId: string;
  title: string;
  signalKey: string;
  items: HubTopicMaterialItem[];
  authorCount: number;
  kindFamilies: string[];
};

export type HubTopicMaterialFailure =
  | "candidate_not_found"
  | "not_a_hub_topic_candidate"
  | "candidate_closed"
  | "already_drafted"
  | "material_no_longer_sufficient";

/* ------------------------------------------------------------- material */

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A stable UUID-shaped id for one Hub item, because the claim contract anchors quotes to uuid chunk ids. */
export async function hubChunkId(kind: HubEvidenceKind, itemId: string) {
  const hex = await sha256Hex(`hubpedia-hub-chunk-v1\n${kind}\n${itemId}`);
  const variant = "89ab"[Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function hubTopicSlug(candidateId: string) {
  return `hub-topic-${candidateId.toLowerCase().replace(/[^a-z0-9]/gu, "").slice(0, 12) || "x"}`;
}

/**
 * Re-read every member of a candidate through the eligibility gate. Items that
 * were opted out, deleted or made private since detection are dropped, and if
 * what is left no longer meets the thresholds nothing is returned.
 */
export async function loadHubTopicMaterial(
  db: D1Database,
  candidateId: string,
): Promise<{ ok: true; material: HubTopicMaterial } | { ok: false; reason: HubTopicMaterialFailure }> {
  const candidate = await db
    .prepare(
      `SELECT c.id AS id, c.status AS status, t.signal_key AS signalKey, t.topic_label AS label, t.draft_article_slug AS drafted
       FROM hubpedia_article_candidates c
       LEFT JOIN hubpedia_hub_topic_candidates t ON t.candidate_id = c.id
       WHERE c.id = ?`,
    )
    .bind(candidateId)
    .first<{ id: string; status: string; signalKey: string | null; label: string | null; drafted: string | null }>();
  if (!candidate) return { ok: false, reason: "candidate_not_found" };
  if (!candidate.signalKey || !candidate.label) return { ok: false, reason: "not_a_hub_topic_candidate" };
  if (candidate.status === "rejected" || candidate.status === "merged") return { ok: false, reason: "candidate_closed" };
  if (candidate.drafted) return { ok: false, reason: "already_drafted" };

  const rows = (
    await db
      .prepare("SELECT kind, item_id AS itemId FROM hubpedia_hub_topic_candidate_items WHERE candidate_id = ? ORDER BY kind, item_id")
      .bind(candidateId)
      .all<{ kind: HubEvidenceKind; itemId: string }>()
  ).results;
  const items: HubTopicMaterialItem[] = [];
  for (const row of rows) {
    const item = await evaluateHubItem(db, row.kind, row.itemId);
    if (!item.eligible) continue;
    const quote = limitQuote(item.text);
    items.push({
      kind: row.kind,
      itemId: row.itemId,
      authorProfileId: item.authorProfileId,
      quote,
      snapshotSha256: await hubItemContentHash(row.kind, item.text),
      chunk: {
        id: await hubChunkId(row.kind, row.itemId),
        sourceUrl: `hub-item:///${row.kind}/${encodeURIComponent(row.itemId)}`,
        sourceTitle: `Hub ${row.kind}`,
        textContent: quote,
      },
    });
  }
  const authors = new Set(items.map((item) => item.authorProfileId));
  const families = new Set(items.map((item) => kindFamily(item.kind)));
  if (authors.size < HUB_TOPIC_MIN_AUTHORS || families.size < HUB_TOPIC_MIN_KIND_FAMILIES) {
    return { ok: false, reason: "material_no_longer_sufficient" };
  }
  return {
    ok: true,
    material: {
      candidateId,
      title: candidate.label,
      signalKey: candidate.signalKey,
      items,
      authorCount: authors.size,
      kindFamilies: [...families].sort(),
    },
  };
}

/* ----------------------------------------------------------- job planning */

const HUB_CLAIM_SYSTEM = [
  FACTORY_CLAIM_EXTRACTION_SYSTEM,
  "The excerpts are short quotes from public posts, threads, research notes, articles, videos and works shared by different members of a community.",
  "Write each claim as an attributed statement of what members reported, argued or described, not as established fact.",
  "Never include a member's name, handle, address or any other personal detail, and never return a claim that rests on a single member's remark unless it states a concrete, checkable fact.",
].join(" ");

const HUB_ARTICLE_ADDENDUM = [
  "The claims come from public community material, not from reference works.",
  "Present them as views, reports and descriptions that exist in the community, with the uncertainty that implies, and never as settled fact.",
  "Do not name or describe any individual member.",
].join(" ");

export function planHubTopicClaimJobs(material: HubTopicMaterial): HubpediaAiJob[] {
  const slug = hubTopicSlug(material.candidateId);
  return planFactoryClaimJobs({ slug, title: material.title }, material.items.map((item) => item.chunk)).map((job) => ({
    ...job,
    system: HUB_CLAIM_SYSTEM,
  }));
}

export type HubTopicClaimCheck = {
  claims: VerifiedFactoryClaim[];
  authors: number;
  kindFamilies: string[];
  sufficient: boolean;
  reasons: string[];
};

function spanOf(claims: readonly VerifiedFactoryClaim[], material: HubTopicMaterial) {
  const byChunk = new Map(material.items.map((item) => [item.chunk.id, item]));
  const used = claims.flatMap((claim) => claim.evidence.flatMap((evidence) => byChunk.get(evidence.chunkId) ?? []));
  return {
    authors: new Set(used.map((item) => item.authorProfileId)).size,
    families: [...new Set(used.map((item) => kindFamily(item.kind)))].sort(),
  };
}

/** Verbatim-quote check on the model's claims, then the thresholds again on what survived. */
export function verifyHubTopicClaims(responses: readonly FactoryClaimsResponse[], material: HubTopicMaterial): HubTopicClaimCheck {
  const claims = verifyFactoryClaims(responses, material.items.map((item) => item.chunk));
  const floor = assessEvidenceSufficiency(claims, HUB_TOPIC_EVIDENCE_FLOOR);
  const span = spanOf(claims, material);
  const reasons = [...floor.reasons];
  if (span.authors < HUB_TOPIC_MIN_AUTHORS) reasons.push(`verified claims rest on ${span.authors} author(s); ${HUB_TOPIC_MIN_AUTHORS} are needed.`);
  if (span.families.length < HUB_TOPIC_MIN_KIND_FAMILIES) reasons.push(`verified claims rest on ${span.families.length} kind(s) of item; ${HUB_TOPIC_MIN_KIND_FAMILIES} are needed.`);
  return { claims, authors: span.authors, kindFamilies: span.families, sufficient: reasons.length === 0, reasons };
}

export function planHubTopicArticleJob(
  material: HubTopicMaterial,
  claims: readonly VerifiedFactoryClaim[],
  linkTargets: ReadonlyArray<{ slug: string; title: string }> = [],
): HubpediaAiJob {
  const topic = {
    slug: hubTopicSlug(material.candidateId),
    title: material.title,
    topicType: "concept",
    categoryLabel: "Hub",
    sources: [],
  } as unknown as FactoryResearchTopic;
  const job = planFactorySourcedArticleJob(topic, claims, linkTargets);
  return { ...job, system: `${job.system} ${HUB_ARTICLE_ADDENDUM}` };
}

/* ------------------------------------------------------------------- lint */

/* Cognitive-rhythm rules (docs/hubpedia-cognitive-rhythm.md): no text that
 * announces the article's own progress. And nothing that names a member. */
const META_PHRASES = ["この記事では", "本節では", "この節では", "ここまでで分かった", "この節の目的", "次は", "以下では"];

export function lintHubTopicDraft(draft: ArticleDraft): string[] {
  const issues: string[] = [];
  const texts = [draft.title, draft.summary, ...draft.sections.flatMap((section) => [section.heading, ...section.paragraphs.map((paragraph) => paragraph.text)])];
  for (const text of texts) {
    for (const phrase of META_PHRASES) {
      if (text.includes(phrase)) issues.push(`meta-writing phrase "${phrase}"`);
    }
    if (/(?:^|[\s(（「])@[\p{L}\p{N}_]{2,}/u.test(text)) issues.push("text names a member handle");
    if (/https?:\/\//iu.test(text)) issues.push("text contains a URL; links belong in evidence, not prose");
  }
  return [...new Set(issues)];
}

/* ---------------------------------------------------------------- persist */

export type ExternalEvidenceInput = { claimIndex: number; chunkId: string; quote: string };

export type PersistHubTopicDraftInput = {
  material: HubTopicMaterial;
  claims: readonly VerifiedFactoryClaim[];
  draft: ArticleDraft;
  /** Identifies the generating run. Stored as ai_run_id and as generation_metadata.pipelineRunId. */
  runId: string;
  /** Existing source chunks that also support a claim (1-based claim index, verbatim quote). */
  external?: readonly ExternalEvidenceInput[];
};

export type PersistHubTopicDraftResult =
  | { ok: true; articleSlug: string; revisionId: string; claimIds: string[]; claimCount: number }
  | { ok: false; reason: string; details?: string[] };

function normalizeClaimText(statement: string) {
  return statement.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ja");
}

/**
 * Write the draft. Fail closed and write nothing when any cited claim loses
 * its Hub evidence between generation and now (an opt-out, a deletion), or when
 * what is cited no longer spans enough authors and kinds.
 */
export async function persistHubTopicDraft(
  db: D1Database,
  input: PersistHubTopicDraftInput,
  now: Date = new Date(),
): Promise<PersistHubTopicDraftResult> {
  const { material, draft, runId } = input;
  if (!/^[A-Za-z0-9:_.-]{3,120}$/u.test(runId)) return { ok: false, reason: "invalid_run_id" };

  const fresh = await loadHubTopicMaterial(db, material.candidateId);
  if (!fresh.ok) return { ok: false, reason: fresh.reason };

  const lint = lintHubTopicDraft(draft);
  if (lint.length) return { ok: false, reason: "draft_failed_lint", details: lint };

  let rendered: ReturnType<typeof renderArticleMarkdown>;
  try {
    rendered = renderArticleMarkdown(draft, input.claims.length);
  } catch (error) {
    return { ok: false, reason: "uncited_paragraph", details: [error instanceof Error ? error.message : "render failed"] };
  }
  const cited = rendered.citationIndexes.map((index) => ({ index, claim: input.claims[index - 1] }));
  if (cited.length < HUB_TOPIC_EVIDENCE_FLOOR.minimumClaims) return { ok: false, reason: "too_few_cited_claims" };
  const span = spanOf(cited.map((entry) => entry.claim), fresh.material);
  if (span.authors < HUB_TOPIC_MIN_AUTHORS || span.families.length < HUB_TOPIC_MIN_KIND_FAMILIES) {
    return { ok: false, reason: "cited_claims_span_too_little", details: [`${span.authors} authors, ${span.families.length} kinds`] };
  }

  /* Evidence through the same gate every other path uses, immediately before writing. */
  const itemByChunk = new Map(fresh.material.items.map((item) => [item.chunk.id, item]));
  const evidenceByClaim = new Map<number, Array<{ kind: HubEvidenceKind; itemId: string; quote: string; sha: string; capturedAt: string }>>();
  const refused: string[] = [];
  for (const { index, claim } of cited) {
    const rows = new Map<string, { kind: HubEvidenceKind; itemId: string; quote: string; sha: string; capturedAt: string }>();
    for (const evidence of claim.evidence) {
      const item = itemByChunk.get(evidence.chunkId);
      if (!item) continue;
      const captured = await captureHubItem(db, item.kind, item.itemId, now);
      if (!captured.ok) {
        refused.push(`${item.kind}:${captured.reason}`);
        continue;
      }
      rows.set(`${item.kind}\u0000${item.itemId}`, {
        kind: item.kind, itemId: item.itemId, quote: captured.snapshot.quote,
        sha: captured.snapshot.snapshotSha256, capturedAt: captured.snapshot.capturedAt,
      });
    }
    if (!rows.size) return { ok: false, reason: "claim_lost_all_hub_evidence", details: [`claim ${index}`, ...refused] };
    evidenceByClaim.set(index, [...rows.values()]);
  }

  /* Optional external support: a real source chunk that contains the quote. */
  const externalRows: Array<{ index: number; chunkId: string; quote: string }> = [];
  for (const external of input.external ?? []) {
    if (!evidenceByClaim.has(external.claimIndex)) continue;
    const chunk = await db
      .prepare("SELECT text_content AS text FROM encyclopedia_source_chunks WHERE id = ?")
      .bind(external.chunkId)
      .first<{ text: string }>();
    if (!chunk || !external.quote || !chunk.text.includes(external.quote)) {
      return { ok: false, reason: "external_evidence_not_verbatim", details: [`claim ${external.claimIndex}`] };
    }
    externalRows.push({ index: external.claimIndex, chunkId: external.chunkId, quote: external.quote });
  }

  const slug = hubTopicSlug(material.candidateId);
  const taken = await db
    .prepare("SELECT 1 AS found FROM encyclopedia_articles WHERE slug = ? UNION ALL SELECT 1 FROM encyclopedia_topics WHERE slug = ?")
    .bind(slug, slug)
    .first();
  if (taken) return { ok: false, reason: "slug_taken" };

  const seconds = Math.floor(now.getTime() / 1000);
  const stamp = now.toISOString();
  const topicId = crypto.randomUUID();
  const articleId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const claimIds = cited.map(() => crypto.randomUUID());
  const metadata = JSON.stringify({
    pipelineRunId: runId,
    reviewRequired: true,
    /* Honoured by the phase 4 sitemap/robots work; until a human has reviewed a
     * revision it must not be indexed. */
    indexing: "noindex",
    origin: "hub-topic",
    candidateId: material.candidateId,
    reading: draft.reading,
    aliases: [...new Set(draft.aliases)],
    categoryIds: [...new Set(draft.categoryIds)]
      .filter((id) => ENCYCLOPEDIA_CATEGORIES.some((category) => category.id === id) || Boolean(getEncyclopediaCategoryNode(id)))
      .slice(0, 4),
  });

  const statements = [
    db.prepare(
      `INSERT INTO encyclopedia_topics(id, canonical_name, slug, description, topic_type, status, created_at, updated_at)
       VALUES(?, ?, ?, NULL, 'concept', 'proposed', ?, ?)`,
    ).bind(topicId, draft.title.slice(0, 200), slug, seconds, seconds),
    db.prepare(
      `INSERT INTO encyclopedia_articles(id, topic_id, title, slug, status, created_at, updated_at)
       VALUES(?, ?, ?, ?, 'draft', ?, ?)`,
    ).bind(articleId, topicId, draft.title, slug, seconds, seconds),
    db.prepare(
      `INSERT INTO encyclopedia_article_revisions
         (id, article_id, revision_number, title, summary, body_markdown, generation_metadata, created_by, author_kind, contributors_json, ai_run_id, created_at)
       VALUES(?, ?, 1, ?, ?, ?, ?, 'encyclopedia-ai-worker', 'ai', '[]', ?, ?)`,
    ).bind(revisionId, articleId, draft.title, draft.summary, rendered.bodyMarkdown, metadata, runId, seconds),
    db.prepare("UPDATE encyclopedia_articles SET current_revision_id = ? WHERE id = ?").bind(revisionId, articleId),
    db.prepare(
      `INSERT INTO encyclopedia_review_findings(id, revision_id, claim_id, finding_type, severity, status, message, location, metadata, created_at, updated_at)
       VALUES(?, ?, NULL, 'ai_generated_requires_review', 'warning', 'open', ?, '{}', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), revisionId, "AI-generated revision must be reviewed before publication.",
      JSON.stringify({ pipelineRunId: runId }), seconds, seconds,
    ),
  ];
  cited.forEach(({ index, claim }, position) => {
    const claimId = claimIds[position];
    statements.push(
      db.prepare(
        `INSERT INTO encyclopedia_claims(id, topic_id, statement, normalized_statement, status, confidence, metadata, created_at, updated_at)
         VALUES(?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`,
      ).bind(claimId, topicId, claim.statement, normalizeClaimText(claim.statement), Math.min(1, Math.max(0, claim.confidence)), JSON.stringify({ generatedByRunId: runId, origin: "hub-topic" }), seconds, seconds),
      db.prepare("INSERT INTO encyclopedia_revision_claims(revision_id, claim_id, citation_index, created_at) VALUES(?, ?, ?, ?)")
        .bind(revisionId, claimId, index, seconds),
    );
    for (const evidence of evidenceByClaim.get(index) ?? []) {
      statements.push(
        db.prepare(
          `INSERT INTO hubpedia_hub_item_evidence
             (id, claim_id, kind, item_id, stance, snapshot_sha256, captured_at, quote, status, last_checked_at, created_at)
           VALUES(?, ?, ?, ?, 'supports', ?, ?, ?, 'active', ?, ?)`,
        ).bind(crypto.randomUUID(), claimId, evidence.kind, evidence.itemId, evidence.sha, evidence.capturedAt, evidence.quote, stamp, stamp),
      );
    }
    for (const external of externalRows.filter((row) => row.index === index)) {
      statements.push(
        db.prepare(
          `INSERT INTO encyclopedia_claim_evidence(claim_id, chunk_id, stance, quote, relevance, metadata, created_at)
           VALUES(?, ?, 'supports', ?, ?, ?, ?)
           ON CONFLICT(claim_id, chunk_id) DO NOTHING`,
        ).bind(claimId, external.chunkId, external.quote, Math.min(1, Math.max(0, claim.confidence)), JSON.stringify({ generatedByRunId: runId }), seconds),
      );
    }
    /* An AI draft starts at provisional whatever it cites; only a person or the
     * knowledge cycle promotes it, and recomputeClaimKnowledge below can only lower it. */
    statements.push(
      db.prepare(
        `INSERT INTO hubpedia_claim_knowledge_state(claim_id, knowledge_status, evidence_type, reproducibility, confidence, last_checked_at, checked_by, updated_at)
         VALUES(?, 'provisional', 'other', 'not-applicable', ?, ?, 'hubpedia-hub-topics', ?)`,
      ).bind(claimId, Math.min(1, Math.max(0, claim.confidence)), stamp, stamp),
    );
  });
  statements.push(
    db.prepare(
      `INSERT INTO hubpedia_article_knowledge_state(article_slug, article_type, knowledge_status, reproducibility, last_synthesized_at, ai_generated_ratio, human_review_scope, synthesis_version, updated_at)
       VALUES(?, 'general', 'provisional', 'not-applicable', ?, 1, NULL, 'hub-topic-v1', ?)
       ON CONFLICT(article_slug) DO NOTHING`,
    ).bind(slug, stamp, stamp),
    db.prepare(
      `UPDATE hubpedia_hub_topic_candidates SET draft_article_slug = ?, draft_ai_run_id = ?, drafted_at = ?, updated_at = ?
       WHERE candidate_id = ? AND draft_article_slug IS NULL`,
    ).bind(slug, runId, stamp, stamp, material.candidateId),
    db.prepare("UPDATE hubpedia_article_candidates SET status = 'reviewing', updated_at = ? WHERE id = ? AND status = 'queued'")
      .bind(stamp, material.candidateId),
  );
  await db.batch(statements);
  for (const claimId of claimIds) await recomputeClaimKnowledge(db, claimId, now);
  return { ok: true, articleSlug: slug, revisionId, claimIds, claimCount: claimIds.length };
}

/* ---------------------------------------------------------------- dry run */

export type HubTopicDraftPlan = {
  candidateId: string;
  title: string;
  signalKey: string;
  items: number;
  authors: number;
  kindFamilies: string[];
  slug: string;
  claimJobs: number;
  /** What would be written, stated without writing it. */
  wouldWrite: string[];
};

export function describeHubTopicDraftPlan(material: HubTopicMaterial): HubTopicDraftPlan {
  return {
    candidateId: material.candidateId,
    title: material.title,
    signalKey: material.signalKey,
    items: material.items.length,
    authors: material.authorCount,
    kindFamilies: material.kindFamilies,
    slug: hubTopicSlug(material.candidateId),
    claimJobs: planHubTopicClaimJobs(material).length,
    wouldWrite: [
      "encyclopedia_topics + encyclopedia_articles (status draft)",
      "encyclopedia_article_revisions (author_kind ai, ai_run_id, noindex)",
      "encyclopedia_claims (proposed) + hubpedia_hub_item_evidence (captureHubItem)",
      "hubpedia_claim_knowledge_state (provisional), hubpedia_article_knowledge_state",
      "encyclopedia_review_findings ai_generated_requires_review (open)",
    ],
  };
}
