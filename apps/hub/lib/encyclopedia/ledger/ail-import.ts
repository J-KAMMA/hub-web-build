import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";

import { canonicalHubpediaSlug } from "../article-aliases";
import { auditFactoryLocalizedDraft, FACTORY_FORBIDDEN_FILLER } from "../factory";
import { isSourceHousekeepingQuote } from "../factory-research";
import { findAilSourcePublisher } from "../source-categories";
import { normalizeSourceUrl } from "../url-security";
import { checkClaimStatement } from "./claim-hygiene";
import { deriveSummary, computeComposeKey } from "./compose";
import { claimKeyOf, normalizeClaimText, nowSeconds, resolveRootClaim } from "./dedupe";
import { newLedgerRef } from "./extract";
import { defaultFetchPage, LEDGER_TOPIC_ID, processLedgerUrl, type FetchedPage, type IngestDeps } from "./ingest";
import type { LedgerFeed, TrustedLookup } from "./feeds";
import { SnapshotReader, type LedgerObjectStore } from "./object-store";
import { slugFromLabel } from "./ail-terms";
import { isProtectedSlug } from "./select";
import { alignTranslation, checkLedgerArticle, stripMarkers, LEDGER_REF_PATTERN } from "./sentence-check";
import { beginComposeRun, findRevisionByComposeKey, finishComposeRun, hydrateClaims, recordAiCall, storeLedgerArticle, type LedgerClaimRow } from "./store";
import {
  evaluateLedgerGate, getLedgerPoolTopicId, isDistantTopic, isSensitiveLedgerTopic, isSensitiveTopicName,
  LEDGER_STUB_FLOOR, recomputeTopicStats, resolveTopics,
} from "./topics";

/*
 * Importer for articles written by the AIL "hubpedia" worker project (agents/projects/hubpedia). The worker's JSON is an
 * untrusted claim, not evidence: every source URL is fetched again here through the ledger's own ingest (admission by the
 * reviewed-publisher list, SSRF-safe fetch, snapshot and chunks), and a claim survives only when its quote is found in
 * that fetched text (NFKC and whitespace normalised). The quote that is stored is the page's own text for the matched
 * span, so the sentence check's exact substring rule holds. The body then goes through the ledger's sentence check and
 * evidence gate (evaluateLedgerGate); what fails is deleted, and an article that no longer meets a gate is not stored.
 * It writes only to the database it is given (the throwaway SQLite of the CLI), as an AI draft: noindex, review required.
 */

export const AIL_PROMPT_VERSION = "ail-hubpedia-v1";
export const AIL_MODEL = "opencode-deepseek-v4.1-flash";
export const AIL_SERVED_BY = "ail-hubpedia";

const text = (max: number) => z.string().trim().min(1).max(max);

export const ailArticleSchema = z.object({
  qid: z.string().regex(/^Q\d+$/u),
  title_ja: text(200),
  title_en: text(200),
  aliases_ja: z.array(text(200)).max(30).optional().default([]),
  sensitive: z.boolean().optional(),
  claims: z.array(z.object({
    id: z.string().regex(/^c\d+$/u),
    statement_ja: text(600),
    statement_en: text(800).optional().default(""),
    source_url: text(2000),
    quote: text(1000),
    confidence: z.number().min(0).max(1),
  })).min(1).max(80),
  body_ja: text(40_000),
  body_en: text(60_000),
});
export type AilArticle = z.infer<typeof ailArticleSchema>;

/** What the term net knows about the topic, when the snapshot is at hand. Without it the importer is stricter, never looser. */
export type AilTermInfo = {
  slug?: string;
  labelJa?: string | null;
  labelEn?: string | null;
  aliasesJa?: readonly string[];
  aliasesEn?: readonly string[];
  hops?: number;
  sensitive?: boolean;
};

/* ---- quote location: NFKC and whitespace insensitive, answered as a span of the page's own text ---- */

export type NormalizedText = { norm: string; start: number[]; end: number[] };

/** NFKC + whitespace-collapsed text with, for each output character, the span of raw text it came from. */
export function normalizeWithMap(raw: string): NormalizedText {
  const norm: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  let lastSpace = true; // leading whitespace is dropped
  for (const match of raw.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    for (const char of match[0].normalize("NFKC")) {
      if (/\s/u.test(char)) {
        if (lastSpace) continue;
        norm.push(" "); start.push(from); end.push(to); lastSpace = true;
      } else {
        norm.push(char); start.push(from); end.push(to); lastSpace = false;
      }
    }
  }
  if (norm[norm.length - 1] === " ") { norm.pop(); start.pop(); end.pop(); }
  return { norm: norm.join(""), start, end };
}

export const normalizeForMatch = (value: string) => normalizeWithMap(value).norm;

/** The span of `page` (raw offsets) whose normalised text equals the normalised quote, or null. */
export function locateQuote(page: NormalizedText, quote: string): { start: number; end: number } | null {
  const needle = normalizeForMatch(quote);
  if (needle.length < 12) return null;
  const at = page.norm.indexOf(needle);
  if (at < 0) return null;
  /* indexOf counts UTF-16 units, the map counts code points. */
  const length = [...needle].length;
  const first = [...page.norm.slice(0, at)].length;
  if (first + length > page.start.length) return null;
  return { start: page.start[first], end: page.end[first + length - 1] };
}

/* ---- markers ---- */

const MARKER = /\{c:([^}]*)\}/gu;

/** Rewrites the worker's claim ids (c1, c2) to ledger refs. An id with no live claim becomes an invalid ref, so its sentence is deleted by rule 2. */
export function remapMarkers(body: string, refs: ReadonlyMap<string, string>): string {
  return body.replace(MARKER, (_all, list: string) => {
    const mapped = list.split(",").map((id) => id.trim()).filter(Boolean).map((id) => refs.get(id) ?? "dropped");
    return `{c:${[...new Set(mapped)].join(",")}}`;
  });
}

export { slugFromLabel };

/* ---- the import ---- */

export type ClaimDrop = { id: string; reason: string };

export type AilImportResult = {
  qid: string;
  slug: string;
  status: "stored-full" | "stored-stub" | "rejected" | "duplicate" | "skipped";
  reason?: string;
  claimsGiven: number;
  claimsKept: number;
  dropped: ClaimDrop[];
  sources: number;
  citedClaims: number;
  droppedSentences: number;
  english: boolean;
  articleId?: string;
  revisionId?: string;
};

export type AilImportDeps = {
  db: D1Database;
  objects: LedgerObjectStore;
  /** Replaces the network fetch (tests). */
  fetchPage?: (url: string) => Promise<FetchedPage>;
  /** Pages the Hub already fetched for the job (ail-prefetch.ts): used instead of the network when present, fresh and sha256-intact; null means fetch again. */
  prefetched?: (url: string) => FetchedPage | null;
  lookup?: TrustedLookup;
  term?: AilTermInfo;
  now?: Date;
  /** The reviewer's final verdict for this article was FIX: stored with needsReview. */
  needsReview?: boolean;
};

export function feedFor(url: string, lookup: TrustedLookup): LedgerFeed | null {
  const trusted = lookup(url);
  if (!trusted) return null;
  const gov = trusted.license.startsWith("US-GOV");
  return {
    id: "ail-hubpedia",
    label: "AIL Hubpedia worker sources (reviewed publishers only)",
    publisherDomain: trusted.domain,
    sourceType: trusted.sourceType ?? (gov ? "government" : "research-institute"),
    reliabilityTier: trusted.reliabilityTier ?? (gov ? "official" : "trusted-secondary"),
    recheckDays: 365,
    discovery: { type: "urls", urls: [] },
    takes: "The page a worker cited, fetched again by the importer.",
    leavesOut: "Everything else.",
    status: "enabled",
  };
}

type SourcePage = { url: string; sourceId: string; body: string; map: NormalizedText; chunks: Array<{ id: string; start: number; end: number }> };

async function loadSourcePage(deps: AilImportDeps, workerUrl: string, finalUrls: Map<string, string>, reader: SnapshotReader, ingest: IngestDeps): Promise<{ page: SourcePage } | { reason: string }> {
  let normalized: string;
  try { normalized = normalizeSourceUrl(workerUrl); } catch { return { reason: "invalid-url" }; }
  const lookup = deps.lookup ?? findAilSourcePublisher;
  const feed = feedFor(normalized, lookup);
  if (!feed) return { reason: "publisher-not-reviewed" };
  const outcome = await processLedgerUrl(ingest, feed, normalized);
  if (outcome.outcome === "rejected" || outcome.outcome === "failed" || outcome.outcome === "skipped") return { reason: `source-${outcome.outcome}-${outcome.reason ?? "unknown"}`.slice(0, 80) };
  const url = finalUrls.get(normalized) ?? normalized;
  const normalizedFinal = (() => { try { return normalizeSourceUrl(url); } catch { return normalized; } })();
  const row = await deps.db.prepare(
    `SELECT s.id AS sourceId, sn.id AS snapshotId, sn.body_object_key AS bodyKey, sn.body_sha256 AS bodySha
       FROM encyclopedia_sources s JOIN encyclopedia_source_snapshots sn ON sn.source_id = s.id
      WHERE s.topic_id = ? AND s.normalized_url = ? AND sn.extraction_status = 'succeeded'
      ORDER BY sn.retrieved_at DESC LIMIT 1`,
  ).bind(LEDGER_TOPIC_ID, normalizedFinal).first<{ sourceId: string; snapshotId: string; bodyKey: string | null; bodySha: string | null }>();
  if (!row?.bodyKey || !row.bodySha) return { reason: "snapshot-missing" };
  let body: string;
  try { body = await reader.body({ key: row.bodyKey, sha256: row.bodySha }); } catch { return { reason: "snapshot-unreadable" }; }
  const chunks = (await deps.db.prepare("SELECT id, start_offset AS start, end_offset AS end FROM encyclopedia_source_chunks WHERE snapshot_id = ? ORDER BY chunk_index").bind(row.snapshotId).all<{ id: string; start: number; end: number }>()).results ?? [];
  return { page: { url: normalizedFinal, sourceId: row.sourceId, body, map: normalizeWithMap(body), chunks } };
}

type KeptClaim = { id: string; statement: string; statementEn: string; confidence: number; chunkId: string; quote: string; sourceUrl: string; confident: boolean };

export async function importAilArticle(raw: unknown, deps: AilImportDeps): Promise<AilImportResult> {
  const parsed = ailArticleSchema.safeParse(raw);
  const blank = (qid: string, slug: string, reason: string, status: AilImportResult["status"] = "rejected"): AilImportResult =>
    ({ qid, slug, status, reason, claimsGiven: 0, claimsKept: 0, dropped: [], sources: 0, citedClaims: 0, droppedSentences: 0, english: false });
  if (!parsed.success) return blank(String((raw as { qid?: unknown } | null)?.qid ?? "?"), "", `schema: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`.slice(0, 160));
  const article = parsed.data;
  const term = deps.term ?? {};
  const slug = canonicalHubpediaSlug(term.slug ?? slugFromLabel(article.title_en));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) return blank(article.qid, slug, "no usable slug");
  if (isProtectedSlug(slug)) return blank(article.qid, slug, "protected slug (an approved or aliased article exists)", "skipped");
  const result: AilImportResult = { ...blank(article.qid, slug, ""), claimsGiven: article.claims.length, reason: undefined };

  /* --- 1. fetch every cited source again and verify quotes against it --- */
  const finalUrls = new Map<string, string>();
  const networkPage = deps.fetchPage ?? defaultFetchPage;
  const basePage = async (url: string): Promise<FetchedPage> => deps.prefetched?.(url) ?? networkPage(url);
  const ingest: IngestDeps = {
    db: deps.db, objects: deps.objects, lookup: deps.lookup ?? findAilSourcePublisher,
    fetchPage: async (url) => { const page = await basePage(url); finalUrls.set(normalizeSourceUrl(url), page.url); return page; },
    fetchText: async () => { throw new Error("not used"); }, fetchJson: async () => { throw new Error("not used"); },
    now: deps.now ? () => deps.now!.getTime() : undefined,
  };
  const reader = new SnapshotReader(deps.objects);
  const pages = new Map<string, { page: SourcePage } | { reason: string }>();
  const names = [article.title_ja, term.labelJa, ...(term.aliasesJa ?? []), ...article.aliases_ja].filter((n): n is string => Boolean(n)).map((n) => n.normalize("NFKC").toLocaleLowerCase("ja"));
  const kept: KeptClaim[] = [];
  for (const claim of article.claims) {
    const drop = (reason: string) => result.dropped.push({ id: claim.id, reason });
    let entry = pages.get(claim.source_url);
    if (!entry) { entry = await loadSourcePage(deps, claim.source_url, finalUrls, reader, ingest); pages.set(claim.source_url, entry); }
    if ("reason" in entry) { drop(entry.reason); continue; }
    const page = entry.page;
    const span = locateQuote(page.map, claim.quote);
    if (!span) { drop("quote-not-found"); continue; }
    const quote = page.body.slice(span.start, span.end);
    if (quote.length > 600) { drop("quote-too-long"); continue; }
    if (isSourceHousekeepingQuote(quote)) { drop("housekeeping-quote"); continue; }
    const chunk = page.chunks.find((c) => c.start <= span.start && span.end <= c.end);
    if (!chunk) { drop("quote-spans-chunks"); continue; }
    const hygiene = checkClaimStatement(claim.statement_ja);
    if (!hygiene.ok) { drop(`statement-${hygiene.reason}`); continue; }
    const lowered = hygiene.statement.normalize("NFKC").toLocaleLowerCase("ja");
    kept.push({
      id: claim.id, statement: hygiene.statement, statementEn: claim.statement_en, confidence: claim.confidence,
      chunkId: chunk.id, quote, sourceUrl: page.url, confident: names.some((n) => n.length >= 2 && lowered.includes(n)),
    });
  }
  result.claimsKept = kept.length;
  result.sources = new Set(kept.map((c) => c.sourceUrl)).size;
  if (kept.length === 0) return { ...result, status: "rejected", reason: "no claim survived verification" };

  /* --- 2. the ledger: topic, claims, evidence, topic links (the verified claims are kept even if the article is not) --- */
  const now = nowSeconds();
  const poolTopicId = await getLedgerPoolTopicId(deps.db);
  const resolved = await resolveTopics(deps.db, [{ slug, label: article.title_ja }], now);
  const topicId = resolved.get(slug);
  if (!topicId) return { ...result, status: "rejected", reason: "topic could not be created" };
  const refs = new Map<string, string>();
  const claimIds: string[] = [];
  for (const claim of kept) {
    const normalized = normalizeClaimText(claim.statement);
    const claimKey = claimKeyOf(claim.statement);
    const keyed = await deps.db.prepare("SELECT id FROM encyclopedia_claims WHERE claim_key = ?").bind(claimKey).first<{ id: string }>();
    const claimId = keyed ? await resolveRootClaim(deps.db, keyed.id) : crypto.randomUUID();
    const statements = [];
    if (!keyed) {
      statements.push(deps.db.prepare(
        `INSERT INTO encyclopedia_claims(id, topic_id, statement, normalized_statement, status, confidence, metadata, created_at, updated_at, claim_key, ledger_ref)
         VALUES(?, ?, ?, ?, 'supported', ?, ?, ?, ?, ?, ?)`,
      ).bind(claimId, poolTopicId, claim.statement, normalized, claim.confidence, JSON.stringify({ importedFrom: AIL_SERVED_BY, qid: article.qid, statementEn: claim.statementEn }), now, now, claimKey, newLedgerRef()));
    }
    statements.push(deps.db.prepare(
      `INSERT OR IGNORE INTO encyclopedia_claim_evidence(claim_id, chunk_id, stance, quote, relevance, metadata, created_at)
       VALUES(?, ?, 'supports', ?, NULL, '{}', ?)`,
    ).bind(claimId, claim.chunkId, claim.quote, now));
    /* A confident link (the topic's own label stands in the sentence) is what counts toward the gate. */
    statements.push(deps.db.prepare(
      `INSERT OR IGNORE INTO hubpedia_ledger_claim_topics(claim_id, topic_id, relevance, assigned_by, created_at) VALUES(?, ?, ?, ?, ?)`,
    ).bind(claimId, topicId, claim.confident ? 1 : 0.5, claim.confident ? "term-label" : "model", now));
    await deps.db.batch(statements);
    const row = await deps.db.prepare("SELECT ledger_ref AS ref FROM encyclopedia_claims WHERE id = ?").bind(claimId).first<{ ref: string | null }>();
    let ref = row?.ref ?? null;
    if (!ref) { ref = newLedgerRef(); await deps.db.prepare("UPDATE encyclopedia_claims SET ledger_ref = ? WHERE id = ?").bind(ref, claimId).run(); }
    refs.set(claim.id, ref);
    claimIds.push(claimId);
  }
  await recomputeTopicStats(deps.db, [topicId], now);

  /* --- 3. the body: sentence check, then the evidence gate on what is left --- */
  const rows = (await deps.db.prepare(
    `SELECT c.id AS id, c.ledger_ref AS ledgerRef, c.statement AS statement, c.status AS status,
            c.merged_into_claim_id AS mergedIntoClaimId, ks.knowledge_status AS knowledgeStatus
       FROM encyclopedia_claims c LEFT JOIN hubpedia_claim_knowledge_state ks ON ks.claim_id = c.id
      WHERE c.id IN (${claimIds.map(() => "?").join(",")})`,
  ).bind(...claimIds).all<LedgerClaimRow>()).results ?? [];
  const hydrated = await hydrateClaims(deps.db, rows, deps.objects);
  const byRef = new Map(hydrated.map((claim) => [claim.ledgerRef, claim]));
  const allowedRefs = new Set(refs.values());
  for (const ref of allowedRefs) if (!LEDGER_REF_PATTERN.test(ref)) return { ...result, status: "rejected", reason: "bad ledger ref" };
  const jaBody = remapMarkers(article.body_ja, refs);
  const checked = checkLedgerArticle({ bodyMarkdown: jaBody }, { claims: byRef, allowedRefs }, LEDGER_STUB_FLOOR);
  result.droppedSentences = checked.dropped.length;
  result.citedClaims = checked.citedRefs.length;
  if (!checked.storable) return { ...result, status: "rejected", reason: `after the sentence check: ${checked.reasons.join(" ")}`.slice(0, 200) };

  const sensitive = term.sensitive === true || article.sensitive === true
    || isSensitiveTopicName(article.title_ja, article.title_en, slug.replace(/-/gu, " "), term.labelJa, term.labelEn)
    || await isSensitiveLedgerTopic(deps.db, topicId);
  const distant = (term.hops ?? 0) >= 2 || await isDistantTopic(deps.db, topicId);
  const gate = evaluateLedgerGate({ claims: checked.citedRefs.length, claimsPerSource: checked.claimsPerSource, distant, sensitive });
  if (!gate.holds && !gate.stub) {
    return { ...result, status: "rejected", reason: `gate: ${checked.citedRefs.length} cited claims, per source [${checked.claimsPerSource.join(",")}]${sensitive ? ", sensitive topic (no stub)" : ""}` };
  }
  const stub = !gate.holds;
  const summary = deriveSummary(checked.body);
  const plain = stripMarkers(checked.body);
  const audit = stub
    ? (FACTORY_FORBIDDEN_FILLER.some((phrase) => plain.includes(phrase)) || plain.includes("�") ? ["filler or corrupted text"] : [])
    : auditFactoryLocalizedDraft(slug, "ja", { title: article.title_ja, summary, bodyMarkdown: plain }, new Set());
  if (audit.length || !summary) return { ...result, status: "rejected", reason: `audit: ${audit.join(" | ") || "no summary"}`.slice(0, 200) };

  /* --- 4. English: markers must survive paragraph by paragraph, else the article is stored without it --- */
  const enAligned = alignTranslation(checked.body, remapMarkers(article.body_en, refs));
  const english = enAligned ? { title: article.title_en, summary: englishSummary(enAligned.body), bodyMarkdown: enAligned.body } : null;
  result.english = english !== null;

  /* --- 5. store as an AI draft (noindex, review required) --- */
  const cited = checked.citedRefs.map((ref) => byRef.get(ref)!);
  const composeKey = computeComposeKey({ topicId, ledgerRefs: checked.citedRefs, promptVersion: AIL_PROMPT_VERSION, model: AIL_MODEL, stub });
  if (await findRevisionByComposeKey(deps.db, topicId, composeKey)) return { ...result, status: "duplicate" };
  const run = await beginComposeRun(deps.db, { topicId, composeKey, promptVersion: AIL_PROMPT_VERSION, now: deps.now });
  if (run.state === "done") return { ...result, status: "duplicate" };
  await recordAiCall(deps.db, { runId: run.runId, provider: AIL_SERVED_BY, model: AIL_MODEL, purpose: "ledger-compose", totalTokens: 0, status: "succeeded", now: deps.now });
  const droppedByRule: Record<string, number> = {};
  for (const unit of checked.dropped) droppedByRule[String(unit.rule)] = (droppedByRule[String(unit.rule)] ?? 0) + 1;
  const stored = await storeLedgerArticle(deps.db, {
    topic: { id: topicId, slug }, title: article.title_ja, summary, bodyMarkdown: checked.body, infobox: [], citedClaims: cited,
    composeKey, promptVersion: AIL_PROMPT_VERSION, model: AIL_MODEL, servedBy: AIL_SERVED_BY, runId: run.runId,
    droppedByRule, quality: null, stub, english, needsReview: deps.needsReview, now: deps.now,
  });
  await finishComposeRun(deps.db, run.runId, { status: "succeeded", output: { result: stored.status }, now: deps.now });
  if (stored.status === "duplicate") return { ...result, status: "duplicate" };
  if (stored.status === "skipped") return { ...result, status: "skipped", reason: stored.reason };
  return { ...result, status: stub ? "stored-stub" : "stored-full", articleId: stored.articleId, revisionId: stored.revisionId };
}

function englishSummary(body: string): string {
  for (const block of body.split(/\n{2,}/u)) {
    const plain = stripMarkers(block).trim();
    if (plain && !plain.startsWith("#")) return plain.slice(0, 300);
  }
  return "";
}
