import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import { canonicalHubpediaSlug } from "../article-aliases";
import { FACTORY_EVIDENCE_FLOOR } from "../factory-research";
import { matchHarmfulIfWrong } from "../unsourced-policy";
import { nowSeconds } from "./dedupe";

/*
 * Claim ledger, topic assignment and per-topic counts (docs/hubpedia-ledger.md section 3, "題材への紐付けと集計").
 * Claims belong to the shared '_ledger' pool topic; this module links them to real topics and keeps
 * hubpedia_ledger_topic_stats so neither rendering nor topic selection ever runs a COUNT.
 */

export const LEDGER_POOL_SLUG = "_ledger";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface TopicCandidate { slug: string; label?: string }

/** Accepts the model's candidates in either shape ("slug" or {slug,label}); drops anything that is not a usable slug. */
export function normalizeTopicCandidates(raw: unknown): TopicCandidate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<string, TopicCandidate>();
  for (const item of raw.slice(0, 20)) {
    const slugValue = typeof item === "string" ? item : (item as { slug?: unknown } | null)?.slug;
    const labelValue = typeof item === "string" ? undefined : (item as { label?: unknown } | null)?.label;
    if (typeof slugValue !== "string") continue;
    const slug = canonicalHubpediaSlug(slugValue.trim().toLowerCase().replace(/[\s_]+/g, "-"));
    if (!SLUG.test(slug) || slug.length > 80) continue;
    const label = typeof labelValue === "string" && labelValue.trim() ? labelValue.trim().slice(0, 120) : undefined;
    if (!seen.has(slug)) seen.set(slug, { slug, label });
  }
  return [...seen.values()];
}

export async function getLedgerPoolTopicId(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT id FROM encyclopedia_topics WHERE slug = ?").bind(LEDGER_POOL_SLUG).first<{ id: string }>();
  if (!row) throw new Error("The '_ledger' pool topic is missing; apply migration 0291 (Lane A) first.");
  return row.id;
}

export type ResolvedTopics = Map<string, string> & { unresolved: string[] };

/**
 * Finds the topic for each candidate, creating unseen ones as status 'proposed' (the default). With `{ create: false }`
 * nothing is created: a slug with no topic row is returned in `unresolved` instead (docs/hubpedia-ledger.md section 9, Lane E).
 */
export async function resolveTopics(
  db: D1Database,
  candidates: TopicCandidate[],
  now = nowSeconds(),
  options: { create?: boolean } = {},
): Promise<ResolvedTopics> {
  const resolved = new Map<string, string>() as ResolvedTopics;
  resolved.unresolved = [];
  for (const candidate of candidates) {
    if (candidate.slug.startsWith("_")) continue;
    let row = await db.prepare("SELECT id, topic_type FROM encyclopedia_topics WHERE slug = ?").bind(candidate.slug).first<{ id: string; topic_type: string }>();
    if (!row && options.create === false) { resolved.unresolved.push(candidate.slug); continue; }
    if (!row) {
      await db.prepare(
        `INSERT OR IGNORE INTO encyclopedia_topics (id, canonical_name, slug, topic_type, status, created_at, updated_at)
         VALUES (?, ?, ?, 'concept', 'proposed', ?, ?)`,
      ).bind(crypto.randomUUID(), candidate.label ?? candidate.slug, candidate.slug, now, now).run();
      row = await db.prepare("SELECT id, topic_type FROM encyclopedia_topics WHERE slug = ?").bind(candidate.slug).first<{ id: string; topic_type: string }>();
    }
    if (row && row.topic_type !== "ledger-pool") resolved.set(candidate.slug, row.id);
  }
  return resolved;
}

export interface HeadwordIndex { entries: Array<{ topicId: string; needle: string }> }

const isCjk = (text: string) => /[぀-ヿ㐀-鿿]/u.test(text);

/** Headword table from existing topics. A name too short to be distinctive is not matched (2+ CJK characters, 4+ Latin). */
export function buildHeadwordIndex(topics: Array<{ id: string; name: string }>): HeadwordIndex {
  const entries: HeadwordIndex["entries"] = [];
  for (const topic of topics) {
    const needle = topic.name.normalize("NFKC").trim().toLocaleLowerCase("ja");
    if (needle.length < (isCjk(needle) ? 2 : 4)) continue;
    entries.push({ topicId: topic.id, needle });
  }
  return { entries };
}

export function matchHeadwords(index: HeadwordIndex, statement: string): string[] {
  const text = statement.normalize("NFKC").toLocaleLowerCase("ja");
  const matched = new Set<string>();
  for (const entry of index.entries) if (text.includes(entry.needle)) matched.add(entry.topicId);
  return [...matched].slice(0, 10);
}

/** Statements that link a claim to topics. INSERT OR IGNORE on (claim_id, topic_id) keeps reruns idempotent. */
export function assignmentStatements(
  db: D1Database,
  claimId: string,
  assignments: Array<{ topicId: string; assignedBy: "model" | "headword" | "term-label" | "term-llm"; relevance: number }>,
  now = nowSeconds(),
): D1PreparedStatement[] {
  return assignments.map((assignment) => db.prepare(
    `INSERT OR IGNORE INTO hubpedia_ledger_claim_topics (claim_id, topic_id, relevance, assigned_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(claimId, assignment.topicId, assignment.relevance, assignment.assignedBy, now));
}

/**
 * The article gate (docs/hubpedia-ledger.md section 4). A claim counts toward a topic only when it is linked with
 * confidence: the topic's headword stands in the claim sentence itself ('headword'), or the term net matched a label in
 * the sentence ('term-label' at relevance 1.0). Alias, quote-only, model-suggested and LLM-picked links are not
 * confident. A source counts only when at least `minClaimsPerSource` distinct confident claims rest on it, so one
 * mislinked claim never makes a second source. A term two or more hops from every seed needs more claims.
 */
export const LEDGER_GATE = { minClaimsPerSource: 2, distantTermMinClaims: 12, distantFromHops: 2, stubMinClaimsInSource: 4 } as const;

/**
 * The one place the gate's numbers are applied. Topic selection (recomputeTopicStats) and the post-deletion check of a
 * regenerated article both call this. `claimsPerSource` holds, per source URL, how many distinct confident claims rest on it.
 */
export function evaluateLedgerGate(input: { claims: number; claimsPerSource: readonly number[]; distant?: boolean; sensitive?: boolean }) {
  const sources = input.claimsPerSource.filter((count) => count >= LEDGER_GATE.minClaimsPerSource).length;
  const minimumClaims = Math.max(FACTORY_EVIDENCE_FLOOR.minimumClaims, input.distant ? LEDGER_GATE.distantTermMinClaims : 0);
  const holds = input.claims >= minimumClaims && sources >= FACTORY_EVIDENCE_FLOOR.minimumSourcesWithClaims;
  /*
   * The stub tier (owner, 2026-10-30): a topic that fails the full gate but has one source with at least four
   * confident claims is composed as a short noindex stub, and upgraded when a later run passes the full gate.
   * Never for a medical, health, legal or drug topic (the caller passes sensitive), and a term two or more hops
   * from every seed needs the same number of claims as for the full article, because its link is the weakest.
   */
  const stub = !holds && input.sensitive !== true
    && Math.max(0, ...input.claimsPerSource) >= LEDGER_GATE.stubMinClaimsInSource
    && (!input.distant || input.claims >= LEDGER_GATE.distantTermMinClaims);
  return { sources, holds, stub };
}

/** What a stub page says about itself, in the reader's words. */
export const LEDGER_STUB_NOTICE = "出典が少ない短い項目";

/** The evidence floor of a stub article (one source, four claims), for the sentence check that stores it. */
export const LEDGER_STUB_FLOOR = { minimumClaims: LEDGER_GATE.stubMinClaimsInSource, minimumSourcesWithClaims: 1 } as const;

/** Wikidata classes whose subjects are medical, health, legal or drug topics (a topic below any of them is sensitive). */
export const SENSITIVE_CLASS_QIDS: readonly string[] = [
  "Q12136", //  disease
  "Q169872", // symptom
  "Q11190", //  medicine
  "Q8386", //   drug
  "Q12140", //  medication
  "Q12147", //  health
  "Q7748", //   law
];

/** Names that mark a medical or health subject beyond the existing harmful-if-wrong list (smoking and cancer are not in it). */
const EXTRA_SENSITIVE_NAME = /(癌|腫瘍|喫煙|禁煙|たばこ|タバコ|栄養失調|感染|疾病|健康|医薬|薬剤|麻薬|中毒|依存症|cancer|tumou?r|smok|tobacco|nicotine|infection|epidemic|pandemic|mortality|nutrition|health|pharma|narcotic|addiction)/iu;

export function isSensitiveTopicName(...names: Array<string | null | undefined>): boolean {
  const text = names.filter(Boolean).join(" ");
  return text !== "" && (matchHarmfulIfWrong(text) !== null || EXTRA_SENSITIVE_NAME.test(text));
}

/**
 * True for a medical, health, legal or drug topic: by name (the existing harmful-if-wrong classification of the
 * unsourced policy, plus a few health words) or by Wikidata class (the term net's own edges: the topic's term, or
 * one of its ancestors within four steps, is a sensitive class). Such a topic keeps the full two-source gate.
 */
export async function isSensitiveLedgerTopic(db: D1Database, topicId: string): Promise<boolean> {
  const topic = await db.prepare("SELECT canonical_name AS name, slug FROM encyclopedia_topics WHERE id = ?").bind(topicId).first<{ name: string | null; slug: string | null }>();
  const term = await db.prepare("SELECT id, label_ja AS labelJa, label_en AS labelEn FROM hubpedia_terms WHERE topic_id = ?").bind(topicId).first<{ id: string; labelJa: string | null; labelEn: string | null }>();
  if (isSensitiveTopicName(topic?.name, topic?.slug?.replace(/-/g, " "), term?.labelJa, term?.labelEn)) return true;
  if (!term) return false;
  const placeholders = SENSITIVE_CLASS_QIDS.map(() => "?").join(",");
  const hit = await db.prepare(
    `WITH RECURSIVE up(term_id, depth) AS (
       SELECT ?, 0
       UNION
       SELECT e.to_term_id, up.depth + 1 FROM up JOIN hubpedia_term_edges e ON e.from_term_id = up.term_id
        WHERE up.depth < 4 AND e.relation IN ('subclass_of', 'instance_of', 'part_of', 'facet_of')
     )
     SELECT 1 AS found FROM up JOIN hubpedia_terms t ON t.id = up.term_id WHERE t.qid IN (${placeholders}) LIMIT 1`,
  ).bind(term.id, ...SENSITIVE_CLASS_QIDS).first<{ found: number }>();
  return hit !== null;
}

/** True for a topic whose term is two or more hops from every seed. */
export async function isDistantTopic(db: D1Database, topicId: string): Promise<boolean> {
  const term = await db.prepare("SELECT MIN(hops) AS hops FROM hubpedia_terms WHERE topic_id = ?").bind(topicId).first<{ hops: number | null }>();
  return term?.hops !== null && term?.hops !== undefined && term.hops >= LEDGER_GATE.distantFromHops;
}

const CONFIDENT_LINK_SQL = `(ct.assigned_by = 'headword' OR (ct.assigned_by = 'term-label' AND ct.relevance >= 1.0))`;
const USABLE_CLAIM_SQL = `c.status = 'supported' AND c.merged_into_claim_id IS NULL
         AND (ks.knowledge_status IS NULL OR ks.knowledge_status NOT IN ('disputed','refuted'))`;

/**
 * Recounts the given topics. A claim is usable when it is supported, not merged away, not disputed or refuted,
 * confidently linked (see LEDGER_GATE), and still has live supporting evidence. Sources are counted by URL, and a
 * source counts when it carries at least LEDGER_GATE.minClaimsPerSource usable claims.
 * Only the topics passed in are touched.
 */
export async function recomputeTopicStats(db: D1Database, topicIds: Iterable<string>, now = nowSeconds()) {
  const done: Array<{ topicId: string; usableClaims: number; usableSources: number; eligible: boolean; stubEligible: boolean }> = [];
  for (const topicId of new Set(topicIds)) {
    const claims = await db.prepare(
      `SELECT COUNT(DISTINCT c.id) AS n FROM hubpedia_ledger_claim_topics ct
       JOIN encyclopedia_claims c ON c.id = ct.claim_id
       LEFT JOIN hubpedia_claim_knowledge_state ks ON ks.claim_id = c.id
       WHERE ct.topic_id = ? AND ${CONFIDENT_LINK_SQL} AND ${USABLE_CLAIM_SQL}
         AND EXISTS (SELECT 1 FROM encyclopedia_claim_evidence e WHERE e.claim_id = c.id AND e.stance = 'supports' AND e.superseded_at IS NULL)`,
    ).bind(topicId).first<{ n: number }>();
    const perSource = (await db.prepare(
      `SELECT COUNT(DISTINCT c.id) AS n FROM hubpedia_ledger_claim_topics ct
         JOIN encyclopedia_claims c ON c.id = ct.claim_id
         LEFT JOIN hubpedia_claim_knowledge_state ks ON ks.claim_id = c.id
         JOIN encyclopedia_claim_evidence e ON e.claim_id = c.id AND e.stance = 'supports' AND e.superseded_at IS NULL
         JOIN encyclopedia_source_chunks ch ON ch.id = e.chunk_id
         JOIN encyclopedia_source_snapshots sn ON sn.id = ch.snapshot_id
         JOIN encyclopedia_sources s ON s.id = sn.source_id AND s.is_active = 1
         WHERE ct.topic_id = ? AND ${CONFIDENT_LINK_SQL} AND ${USABLE_CLAIM_SQL}
         GROUP BY s.url`,
    ).bind(topicId).all<{ n: number }>()).results ?? [];
    const usableClaims = Number(claims?.n ?? 0);
    const claimsPerSource = perSource.map((row) => Number(row.n));
    const distant = await isDistantTopic(db, topicId);
    let gate = evaluateLedgerGate({ claims: usableClaims, claimsPerSource, distant, sensitive: true });
    /* Only a topic that could be a stub is asked whether it is a medical, health, legal or drug topic. */
    if (!gate.holds && evaluateLedgerGate({ claims: usableClaims, claimsPerSource, distant, sensitive: false }).stub) {
      gate = evaluateLedgerGate({ claims: usableClaims, claimsPerSource, distant, sensitive: await isSensitiveLedgerTopic(db, topicId) });
    }
    const usableSources = gate.sources;
    const eligible = gate.holds;
    const stubEligible = gate.stub;
    await db.prepare(
      `INSERT INTO hubpedia_ledger_topic_stats (topic_id, usable_claims, usable_sources, eligible, stub_eligible, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(topic_id) DO UPDATE SET usable_claims = excluded.usable_claims, usable_sources = excluded.usable_sources,
         eligible = excluded.eligible, stub_eligible = excluded.stub_eligible, updated_at = excluded.updated_at`,
    ).bind(topicId, usableClaims, usableSources, eligible ? 1 : 0, stubEligible ? 1 : 0, now).run();
    done.push({ topicId, usableClaims, usableSources, eligible, stubEligible });
  }
  return done;
}

/** Topics linked to the given claims (including claims merged into them), for a post-run recount. */
export async function topicsOfClaims(db: D1Database, claimIds: string[]): Promise<string[]> {
  const topics = new Set<string>();
  for (let offset = 0; offset < claimIds.length; offset += 50) {
    const slice = claimIds.slice(offset, offset + 50);
    const { results } = await db.prepare(
      `SELECT DISTINCT topic_id FROM hubpedia_ledger_claim_topics WHERE claim_id IN (${slice.map(() => "?").join(",")})`,
    ).bind(...slice).all<{ topic_id: string }>();
    for (const row of results) topics.add(row.topic_id);
  }
  return [...topics];
}
