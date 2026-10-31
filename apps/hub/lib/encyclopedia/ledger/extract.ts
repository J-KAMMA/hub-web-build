import { randomBytes } from "node:crypto";
import { checkClaimStatement } from "./claim-hygiene";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import { chunkText } from "../chunk";
import { chunkLocatorColumns, LedgerObjectError, SnapshotReader, type ChunkLocator, type LedgerObjectStore } from "./object-store";
import {
  FACTORY_CLAIM_EXTRACTION_SYSTEM,
  isSourceHousekeepingQuote,
  verifyFactoryClaims,
  type FactoryResearchChunk,
} from "../factory-research";
import { ChainExhaustedError, FilePendingError, completeViaChain, type Adapter, type ChainCall, type ChainOptions, type ProviderId } from "../provider-chain";
import { timed } from "./stage-log";
import { assessEvidenceUse } from "../source-license-policy";
import { claimKeyOf, normalizeClaimText, nowSeconds, resolveRootClaim, sha256Hex } from "./dedupe";
import {
  assignmentStatements,
  getLedgerPoolTopicId,
  matchHeadwords,
  normalizeTopicCandidates,
  resolveTopics,
  type HeadwordIndex,
  type TopicCandidate,
} from "./topics";

/*
 * Claim ledger, extraction (S4) and storage of verified claims (S5).
 * docs/hubpedia-ledger.md section 3. Design points, each one answering a failure seen in the trial:
 *   - chunks of at most 2,000 characters, one chunk per model call
 *   - an LLM-free density pre-pass decides what is worth a call; skipped chunks stay in the table
 *   - every chunk gets a row; a result of zero verified claims is `empty`, retried (halved text, then the next provider)
 *     and only after three attempts `exhausted`. `succeeded` never has zero claims.
 *   - model answers are cached on disk before anything is written to D1
 *   - ChainExhaustedError ends the run cleanly and leaves the remaining rows `pending`
 */

export const LEDGER_PROMPT_VERSION = "ledger-extract-v1";
/** 1 token = 4 characters in chunkText: 500 tokens = 2,000 characters, 50 tokens = 200 characters of overlap. */
export const LEDGER_CHUNKING = { maxTokens: 500, overlapTokens: 50, maxChars: 2000, overlapChars: 200 } as const;
/** Three attempts, plus one more only when attempt 3 could not move to another provider (see extractChunk). */
export const LEDGER_MAX_ATTEMPTS = 4;
export const DENSITY_THRESHOLD = 0.2;
export const DENSITY_TOP_UP = 3;
/** A stored chunk above this size is split again at call time, so one call never carries more than a ledger chunk. */
const MAX_CALL_CHARS = 2400;

export function chunkLedgerText(text: string): string[] {
  return chunkText(text, LEDGER_CHUNKING.maxTokens, LEDGER_CHUNKING.overlapTokens).map((chunk) => chunk.textContent);
}

/* ---------- S4a: density pre-pass (no model) ---------- */

const SENTENCE_SPLIT = /(?<=[。．.!！?？])\s*|\n+/u;
const NAV_BOILERPLATE = /(?:cookie|privacy|subscribe|newsletter|sign in|log in|menu|skip to|follow us|share (?:this|on)|read more|related (?:articles|posts)|table of contents|目次|メニュー|ログイン|会員登録|シェア|関連記事|前の記事|次の記事|トップへ)/iu;
const DEFINITION = /(?:(?:は|とは).{1,60}(?:である|です|のこと|を指す|をいう|と呼ばれる)|\b(?:is|are|was|were) (?:a|an|the)\b|\brefers? to\b|\bis defined as\b|\bknown as\b)/giu;
const YEAR = /(?:\b(?:1[0-9]|20)\d{2}\b|\d{3,4}年)/gu;
const NUMERIC = /\d[\d,.]*\s*(?:%|％|年|月|日|万|億|兆|人|円|ドル|倍|件|度|℃|km|kg|m|g|t|million|billion|trillion|percent)?/giu;
const PROPER = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b|[ァ-ヿ]{3,}/gu;

const isNavLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return NAV_BOILERPLATE.test(trimmed) || (trimmed.length < 30 && !/[。．.!！?？]$/u.test(trimmed));
};

/** True when the chunk has a sentence that states a number: this is the kind of text the verbatim check accepts. */
export function hasNumericStatement(text: string): boolean {
  return text.split(SENTENCE_SPLIT).some((raw) => {
    const sentence = raw.trim();
    if (sentence.length < 15 || !/\d/.test(sentence)) return false;
    if (isNavLine(sentence) && sentence.length < 40) return false;
    return !isSourceHousekeepingQuote(sentence) && !NAV_BOILERPLATE.test(sentence);
  });
}

export function scoreChunkDensity(text: string, titleHint = ""): number {
  const lines = text.split("\n").filter((line) => line.trim());
  const navRatio = lines.length ? lines.filter(isNavLine).length / lines.length : 1;
  const count = (pattern: RegExp) => (text.match(pattern) ?? []).length;
  const numeric = count(NUMERIC);
  const years = count(YEAR);
  const definitions = count(DEFINITION);
  const proper = count(PROPER);
  const sentences = text.split(SENTENCE_SPLIT).filter((sentence) => sentence.trim().length >= 15).length;
  const tokens = titleHint.normalize("NFKC").toLocaleLowerCase("ja").split(/[\s\-_/|:：・、,]+/u).filter((token) => token.length >= 2);
  const lowered = text.normalize("NFKC").toLocaleLowerCase("ja");
  const headword = tokens.some((token) => lowered.includes(token)) ? 1 : 0;
  const raw = 0.25 * Math.min(1, numeric / 6) + 0.15 * Math.min(1, years / 3) + 0.25 * Math.min(1, definitions / 2)
    + 0.15 * Math.min(1, proper / 8) + 0.1 * headword + 0.15 * Math.min(1, sentences / 6);
  let score = raw * (1 - 0.8 * navRatio);
  // A chunk that states a number in running text must reach the model whatever the other features say.
  if (hasNumericStatement(text)) score = Math.max(score, DENSITY_THRESHOLD + 0.01);
  return Math.round(score * 1000) / 1000;
}

/*
 * Boilerplate pre-screen (no model). Citation blocks ("Cite this work", BibTeX, licence notes) and reference lists
 * carry no claim about the topic. They passed the density pre-pass (years, names and numbers look dense) and then
 * burned every retry attempt on an empty answer. Calibrated on the third trial: of 317 real extraction calls, 94 of
 * the 224 that returned nothing match and none of the 93 that returned claims does.
 */
const BOILERPLATE_MARKER = /(?:cite this work|bibtex citation|reuse this work freely|can be cited as|please also cite the underlying data|retrieved from: ?['‘"]|@article\{|\[online resource\]|license terms from the (?:original|third)|subject to the license terms|permission to use, distribute, and reproduce|browse previous versions of this work|always indicate the original source of the data)/iu;
const CITATION_TOKEN = /(?:\(\s*(?:19|20)\d{2}[a-z]?\s*\)|\b(?:19|20)\d{2}\.\s|doi\.org\/|\bet al\b|\bpp?\.\s?\d|\b\d+\(\d+\)\s*[:,]?\s*\d|\bvol\.\s?\d|\bjournal of\b|\bannual review\b|\bproceedings\b|\bISBN\b|\bavailable online\b|\bretrieved from\b)/giu;
const AUTHOR_INITIALS = /\p{Lu}[\p{L}'’-]+,\s(?:\p{Lu}\.\s?-?){1,3}/gu;

/** Characters in sentences that read as prose: long enough, with words, and not themselves a citation. */
function proseLength(text: string): number {
  return text.split(/(?<=[.!?。])\s*|\n+/u).map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40 && /[a-z぀-鿿]{3}/iu.test(sentence)
      && !/(?:doi\.org|\(\s*(?:19|20)\d{2}\s*\)|\bet al\b|journal|available online)/iu.test(sentence))
    .reduce((sum, sentence) => sum + sentence.length, 0);
}

/** True for citation or licence boilerplate: a marker phrase with almost no prose before it, or a reference list. */
export function isBoilerplateChunk(text: string): boolean {
  const normalized = text.normalize("NFKC");
  const marker = BOILERPLATE_MARKER.exec(normalized);
  if (marker && proseLength(normalized.slice(0, marker.index)) < 100) return true;
  const citations = (normalized.match(CITATION_TOKEN) ?? []).length + (normalized.match(AUTHOR_INITIALS) ?? []).length;
  return citations >= 3 && proseLength(normalized) < Math.max(150, normalized.length * 0.3);
}

export interface ScreenInput { id: string; text: string }
/** Decides which chunks of one source go to the model. If none passes, the top three non-boilerplate chunks do. */
export function screenChunks(chunks: ScreenInput[], titleHint = ""): Array<{ id: string; score: number; selected: boolean }> {
  const boilerplate = new Set(chunks.filter((chunk) => isBoilerplateChunk(chunk.text)).map((chunk) => chunk.id));
  const scored = chunks.map((chunk) => ({ id: chunk.id, score: boilerplate.has(chunk.id) ? 0 : scoreChunkDensity(chunk.text, titleHint), selected: false }));
  for (const item of scored) item.selected = item.score >= DENSITY_THRESHOLD;
  if (scored.length && !scored.some((item) => item.selected)) {
    for (const item of scored.filter((entry) => !boilerplate.has(entry.id)).sort((a, b) => b.score - a.score).slice(0, DENSITY_TOP_UP)) item.selected = true;
  }
  return scored;
}

/* ---------- prompt and response ---------- */

const EXTRACTION_SYSTEM = [
  FACTORY_CLAIM_EXTRACTION_SYSTEM,
  "Write each claim in Japanese as one self-contained sentence. Copy each evidence quote character for character from the excerpt, in the excerpt's own language.",
  "For each claim list up to three candidate encyclopedia topics it belongs to: slug (lowercase ASCII words joined by hyphens) and label (the heading word).",
  "If the excerpt holds no claim about a topic, return an empty claims array.",
].join(" ");

const OUTPUT_CONTRACT = {
  claims: [{
    statement: "string — one atomic factual claim, written in Japanese",
    confidence: "number between 0 and 1",
    topics: [{ slug: "lowercase-ascii-hyphenated-slug", label: "heading word" }],
    evidence: [{ quote: "a substring copied verbatim from the excerpt" }],
  }],
};

function buildCall(text: string, sourceTitle: string): ChainCall {
  return {
    system: EXTRACTION_SYSTEM,
    prompt: JSON.stringify({ task: "extract-claims", outputContract: OUTPUT_CONTRACT, sourceTitle, excerpt: text }),
    maxTokens: 4096,
    stage: "extract",
  };
}

interface ModelClaim { statement: string; confidence: number; topics: TopicCandidate[]; quote: string }

class InvalidResponseError extends Error {}

function parseModelClaims(output: unknown): { raw: number; claims: ModelClaim[] } {
  const list = (output as { claims?: unknown } | null)?.claims;
  if (!Array.isArray(list)) throw new InvalidResponseError("invalid-response: no claims array");
  const claims: ModelClaim[] = [];
  for (const item of list) {
    const value = item as { statement?: unknown; confidence?: unknown; topics?: unknown; evidence?: unknown } | null;
    if (!value || typeof value.statement !== "string" || !value.statement.trim() || value.statement.length > 2000) continue;
    const evidence = Array.isArray(value.evidence) ? value.evidence : [];
    const quotes = evidence
      .map((entry) => (typeof entry === "string" ? entry : (entry as { quote?: unknown } | null)?.quote))
      .filter((quote): quote is string => typeof quote === "string" && quote.trim().length > 0)
      .map((quote) => quote.trim().slice(0, 2000));
    if (!quotes.length) continue;
    const confidence = typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1 ? value.confidence : 0.5;
    for (const quote of quotes.slice(0, 5)) {
      claims.push({ statement: value.statement.trim(), confidence, topics: normalizeTopicCandidates(value.topics), quote });
    }
  }
  return { raw: list.length, claims };
}

export interface VerifiedLedgerClaim { statement: string; confidence: number; quote: string; topics: TopicCandidate[] }

/** Keeps only claims whose quote sits verbatim in the chunk and is not page furniture (the factory's own rule). */
export function verifyAgainstChunk(chunk: FactoryResearchChunk, claims: ModelClaim[]): VerifiedLedgerClaim[] {
  const byKey = new Map<string, VerifiedLedgerClaim>();
  for (const original of claims) {
    const hygiene = checkClaimStatement(original.statement);
    if (!hygiene.ok) continue; // dangling start or cut ending: the quote stays verbatim, the sentence is not stored
    const claim = { ...original, statement: hygiene.statement };
    const [verified] = verifyFactoryClaims(
      [{ claims: [{ statement: claim.statement, confidence: claim.confidence, evidence: [{ chunkId: chunk.id, quote: claim.quote }] }] }],
      [chunk],
    );
    if (!verified?.evidence.length) continue;
    const key = claimKeyOf(verified.statement);
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, { statement: verified.statement, confidence: claim.confidence, quote: verified.evidence[0].quote, topics: claim.topics });
    } else {
      const known = new Set(previous.topics.map((topic) => topic.slug));
      previous.topics.push(...claim.topics.filter((topic) => !known.has(topic.slug)));
      if (claim.confidence > previous.confidence) previous.confidence = claim.confidence;
    }
  }
  return [...byKey.values()];
}

/* ---------- model access, cached ---------- */

export type ExtractComplete = (
  call: ChainCall,
  context: { cacheKey: string; excludeProviders: string[] },
) => Promise<{ output: unknown; servedBy: string; tokens: number; cached: boolean }>;

/** Reads and writes model answers as JSON files, so a crash before the D1 write never repeats a call. */
export function jsonFileCache(directory: string) {
  return {
    read(key: string): unknown {
      const path = join(directory, `${key}.json`);
      if (!existsSync(path)) return undefined;
      try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
    },
    write(key: string, value: unknown) {
      mkdirSync(directory, { recursive: true });
      const path = join(directory, `${key}.json`);
      writeFileSync(`${path}.tmp`, JSON.stringify(value), "utf8");
      renameSync(`${path}.tmp`, path);
    },
  };
}

/** The production ExtractComplete: completeViaChain, with `excludeProviders` removed from the adapter list for the call. */
export function chainComplete(options: ChainOptions, cacheDirectory?: string): ExtractComplete {
  const cache = cacheDirectory ? jsonFileCache(cacheDirectory) : undefined;
  return async (call, context) => {
    const hit = cache?.read(context.cacheKey) as { output: unknown; servedBy: string; tokens: number } | undefined;
    if (hit) return { ...hit, cached: true };
    let adapters: Adapter[] = options.adapters;
    const rest = adapters.filter((adapter) => !context.excludeProviders.includes(adapter.id));
    if (rest.length) adapters = rest; // nothing else is configured: retry with what there is
    let served;
    try {
      served = await completeViaChain(call, { ...options, adapters });
    } catch (error) {
      // The other providers are all unavailable right now: go back to the excluded one instead of stopping the run.
      if (!(error instanceof ChainExhaustedError) || adapters === options.adapters) throw error;
      served = await completeViaChain(call, options);
    }
    const record = { output: served.output, servedBy: served.servedBy as string, tokens: served.tokens };
    cache?.write(context.cacheKey, record);
    return { ...record, cached: false };
  };
}

/* ---------- pipeline bookkeeping ---------- */

export interface RunHandle { id: string }

export async function startPipelineRun(db: D1Database, run: { runType: string; idempotencyKey: string; input: unknown; now?: number }): Promise<RunHandle> {
  const now = run.now ?? nowSeconds();
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO encyclopedia_pipeline_runs (id, run_type, status, input, attempt, idempotency_key, started_at, created_at, updated_at)
     VALUES (?, ?, 'running', ?, 1, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET attempt = attempt + 1, status = 'running', updated_at = excluded.updated_at`,
  ).bind(id, run.runType, JSON.stringify(run.input), run.idempotencyKey, now, now, now).run();
  const row = await db.prepare("SELECT id FROM encyclopedia_pipeline_runs WHERE idempotency_key = ?").bind(run.idempotencyKey).first<{ id: string }>();
  return { id: row?.id ?? id };
}

export async function finishPipelineRun(db: D1Database, handle: RunHandle, status: "succeeded" | "failed", output: unknown, now = nowSeconds()) {
  await db.prepare(
    "UPDATE encyclopedia_pipeline_runs SET status = ?, output = ?, completed_at = ?, updated_at = ? WHERE id = ?",
  ).bind(status, JSON.stringify(output), now, now, handle.id).run();
}

/** Provider, model label and token counts only. Neither the instruction text nor the response body is written. */
async function recordAiCall(db: D1Database, runId: string | null, call: { servedBy: string; tokens: number; chunkHash: string; attempt: number; status: "succeeded" | "failed"; error?: string }) {
  const now = nowSeconds();
  await db.prepare(
    `INSERT INTO encyclopedia_ai_calls (id, pipeline_run_id, provider, model, purpose, request_metadata, response_metadata,
       completion_tokens, status, error, started_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, 'ledger-extract', ?, '{}', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), runId, call.servedBy, call.servedBy,
    JSON.stringify({ chunkHash: call.chunkHash, attempt: call.attempt, promptVersion: LEDGER_PROMPT_VERSION }),
    call.tokens, call.status, call.error ?? null, now, now, now,
  ).run();
}

/* ---------- S4b: pre-pass over sources ---------- */

export interface ChunkRow extends ChunkLocator { id: string; snapshot_id: string }
interface SourceRow { id: string; url: string; title: string | null; license: string | null; source_type: string; reliability_tier: string | null; metadata: string | null }

const parseJsonObject = (text: string | null): Record<string, unknown> | null => {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
};

/** Ledger chunks always carry their hash; a legacy chunk without one is hashed from the text D1 still holds. */
const chunkHashOf = (row: ChunkRow) => row.contentHash || sha256Hex(row.legacyText ?? "");

/** Copies live supporting evidence from one chunk to another chunk with the same text (no model call). */
export async function copyEvidenceBetweenChunks(db: D1Database, fromChunkId: string, toChunkId: string) {
  if (fromChunkId === toChunkId) return;
  await db.prepare(
    `INSERT OR IGNORE INTO encyclopedia_claim_evidence (claim_id, chunk_id, stance, quote, relevance, metadata, created_at)
     SELECT claim_id, ?, stance, quote, relevance, metadata, created_at FROM encyclopedia_claim_evidence
     WHERE chunk_id = ? AND superseded_at IS NULL`,
  ).bind(toChunkId, fromChunkId).run();
}

export interface PrescreenSummary { sources: number; chunks: number; pending: number; skipped: number; inherited: number; disallowedSources: number; unreadableSources: number; nextAfterSourceId: string | null }

/**
 * Gives every chunk of each source's newest snapshot an extraction row: `pending` when the density score says it is
 * worth a call, `skipped` otherwise (never deleted). A source that fails the evidence-use policy is skipped whole.
 * Keyed by source id, so an interrupted run continues from `afterSourceId`.
 */
export async function prescreenSources(
  db: D1Database,
  options: { promptVersion?: string; limitSources?: number; afterSourceId?: string; now?: number; objects?: LedgerObjectStore } = {},
): Promise<PrescreenSummary> {
  const promptVersion = options.promptVersion ?? LEDGER_PROMPT_VERSION;
  const now = options.now ?? nowSeconds();
  const reader = new SnapshotReader(options.objects);
  const summary: PrescreenSummary = { sources: 0, chunks: 0, pending: 0, skipped: 0, inherited: 0, disallowedSources: 0, unreadableSources: 0, nextAfterSourceId: null };
  const { results: sources } = await db.prepare(
    `SELECT s.id, s.url, s.title, s.license, s.source_type, s.reliability_tier, s.metadata
     FROM encyclopedia_sources s
     WHERE s.is_active = 1 AND s.id > ? AND EXISTS (
       SELECT 1 FROM encyclopedia_source_chunks c
       WHERE c.snapshot_id = (SELECT n.id FROM encyclopedia_source_snapshots n WHERE n.source_id = s.id ORDER BY n.retrieved_at DESC, n.id DESC LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM hubpedia_ledger_extractions e WHERE e.chunk_hash = c.content_hash AND e.prompt_version = ?
             AND (e.chunk_id = c.id OR e.status <> 'succeeded' OR EXISTS (SELECT 1 FROM encyclopedia_claim_evidence ev WHERE ev.chunk_id = c.id))))
     ORDER BY s.id LIMIT ?`,
  ).bind(options.afterSourceId ?? "", promptVersion, options.limitSources ?? 50).all<SourceRow>();

  for (const source of sources) {
    summary.sources += 1;
    summary.nextAfterSourceId = source.id;
    const { results: chunks } = await db.prepare(
      `SELECT c.id AS id, c.snapshot_id AS snapshot_id, ${chunkLocatorColumns("c", "sn")}
       FROM encyclopedia_source_chunks c JOIN encyclopedia_source_snapshots sn ON sn.id = c.snapshot_id
       WHERE c.snapshot_id = (SELECT n.id FROM encyclopedia_source_snapshots n WHERE n.source_id = ? ORDER BY n.retrieved_at DESC, n.id DESC LIMIT 1)
       ORDER BY c.chunk_index`,
    ).bind(source.id).all<ChunkRow>();
    const hashes = chunks.map(chunkHashOf);
    const existing = new Map<string, { status: string; chunk_id: string }>();
    for (let offset = 0; offset < hashes.length; offset += 50) {
      const slice = hashes.slice(offset, offset + 50);
      const { results } = await db.prepare(
        `SELECT chunk_hash, status, chunk_id FROM hubpedia_ledger_extractions
         WHERE prompt_version = ? AND chunk_hash IN (${slice.map(() => "?").join(",")})`,
      ).bind(promptVersion, ...slice).all<{ chunk_hash: string; status: string; chunk_id: string }>();
      for (const row of results) existing.set(row.chunk_hash, row);
    }

    const verdict = assessEvidenceUse({
      license: source.license, url: source.url, sourceType: source.source_type,
      reliabilityTier: source.reliability_tier, metadata: parseJsonObject(source.metadata),
    });
    if (!verdict.allowed) summary.disallowedSources += 1;

    const fresh = chunks.filter((chunk, index) => !existing.has(hashes[index]));
    const hasLiveSibling = chunks.some((_, index) => {
      const row = existing.get(hashes[index]);
      return row && row.status !== "skipped";
    });
    // Chunk text comes from the verified snapshot body (R2); an unreadable body skips the source and is counted, never guessed.
    let freshTexts: Array<{ id: string; text: string }> = [];
    if (verdict.allowed) {
      try {
        freshTexts = await Promise.all(fresh.map(async (chunk) => ({ id: chunk.id, text: await reader.chunkText(chunk) })));
      } catch (error) {
        if (!(error instanceof LedgerObjectError)) throw error;
        summary.unreadableSources += 1;
        continue;
      }
    }
    const screening = verdict.allowed
      ? screenChunks(freshTexts, source.title ?? "")
      : fresh.map((chunk) => ({ id: chunk.id, score: 0, selected: false }));
    const decision = new Map(screening.map((item) => [item.id, item]));
    // The "none passed, take the top three" rule looks at the whole snapshot, not only at chunks first seen now.
    if (verdict.allowed && hasLiveSibling) for (const item of screening) if (item.score < DENSITY_THRESHOLD) item.selected = false;

    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const hash = hashes[index];
      summary.chunks += 1;
      const known = existing.get(hash);
      if (known) {
        if (known.status === "succeeded" && known.chunk_id !== chunk.id) {
          await copyEvidenceBetweenChunks(db, known.chunk_id, chunk.id);
          summary.inherited += 1;
        }
        continue;
      }
      const item = decision.get(chunk.id);
      const selected = item?.selected === true;
      if (selected) summary.pending += 1; else summary.skipped += 1;
      existing.set(hash, { status: selected ? "pending" : "skipped", chunk_id: chunk.id });
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO hubpedia_ledger_extractions
           (chunk_hash, prompt_version, chunk_id, source_id, status, density_score, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(hash, promptVersion, chunk.id, source.id, selected ? "pending" : "skipped", item?.score ?? 0,
        verdict.allowed ? null : `source-not-allowed:${verdict.reason}`, now));
    }
    for (let offset = 0; offset < statements.length; offset += 100) await db.batch(statements.slice(offset, offset + 100));
  }
  return summary;
}

/* ---------- S5: store verified claims ---------- */

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
/** 12 characters of Crockford base32 = 60 random bits. */
export function newLedgerRef(): string {
  let bits = BigInt("0x" + randomBytes(8).toString("hex")) & ((1n << 60n) - 1n);
  let ref = "";
  for (let index = 0; index < 12; index += 1) {
    ref = CROCKFORD[Number(bits & 31n)] + ref;
    bits >>= 5n;
  }
  return ref;
}

export interface StoreResult { claimIds: string[]; created: number; reused: number }

async function storeClaims(
  db: D1Database,
  args: {
    chunkId: string; chunkHash: string; promptVersion: string; poolTopicId: string; claims: VerifiedLedgerClaim[];
    headwords?: HeadwordIndex; extraction: { raw: number; attempts: number; servedBy: string | null }; now: number;
  },
): Promise<StoreResult> {
  const { claims, now } = args;
  // Existing claim for each key (the survivor, if it was merged), and topic ids for every candidate slug.
  const keyed = claims.map((claim) => ({ claim, key: claimKeyOf(claim.statement) }));
  const existing = new Map<string, string>();
  for (const { key } of keyed) {
    const row = await db.prepare("SELECT id FROM encyclopedia_claims WHERE claim_key = ?").bind(key).first<{ id: string }>();
    if (row) existing.set(key, await resolveRootClaim(db, row.id));
  }
  const slugs = new Map<string, TopicCandidate>();
  for (const { claim } of keyed) for (const topic of claim.topics) slugs.set(topic.slug, topic);
  const topicIds = await resolveTopics(db, [...slugs.values()], now);

  for (let round = 0; round < 5; round += 1) {
    const statements: D1PreparedStatement[] = [];
    const claimIds: string[] = [];
    let created = 0;
    for (const { claim, key } of keyed) {
      let claimId = existing.get(key);
      if (!claimId) {
        claimId = crypto.randomUUID();
        created += 1;
        statements.push(db.prepare(
          `INSERT INTO encyclopedia_claims (id, topic_id, statement, normalized_statement, status, confidence, metadata, created_at, updated_at, claim_key, ledger_ref)
           VALUES (?, ?, ?, ?, 'supported', ?, '{"origin":"ledger"}', ?, ?, ?, ?)`,
        ).bind(claimId, args.poolTopicId, claim.statement, normalizeClaimText(claim.statement), claim.confidence, now, now, key, newLedgerRef()));
      } else {
        // A claim returned to 'proposed' when its evidence was lost is supported again by fresh evidence.
        statements.push(db.prepare("UPDATE encyclopedia_claims SET status = 'supported', updated_at = ? WHERE id = ? AND status = 'proposed'").bind(now, claimId));
      }
      claimIds.push(claimId);
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO encyclopedia_claim_evidence (claim_id, chunk_id, stance, quote, relevance, metadata, created_at)
         VALUES (?, ?, 'supports', ?, ?, '{}', ?)`,
      ).bind(claimId, args.chunkId, claim.quote, claim.confidence, now));
      const assignments = new Map<string, { topicId: string; assignedBy: "model" | "headword"; relevance: number }>();
      for (const topic of claim.topics) {
        const topicId = topicIds.get(topic.slug);
        if (topicId) assignments.set(topicId, { topicId, assignedBy: "model", relevance: 1 });
      }
      if (args.headwords) {
        for (const topicId of matchHeadwords(args.headwords, claim.statement)) {
          if (!assignments.has(topicId)) assignments.set(topicId, { topicId, assignedBy: "headword", relevance: 0.6 });
        }
      }
      statements.push(...assignmentStatements(db, claimId, [...assignments.values()], now));
    }
    statements.push(db.prepare(
      `UPDATE hubpedia_ledger_extractions SET status = 'succeeded', raw_claims = ?, verified_claims = ?, attempts = ?, last_error = NULL,
         served_by = ?, updated_at = ? WHERE chunk_hash = ? AND prompt_version = ?`,
    ).bind(args.extraction.raw, claims.length, args.extraction.attempts, args.extraction.servedBy, now, args.chunkHash, args.promptVersion));
    try {
      for (let offset = 0; offset < statements.length; offset += 100) await db.batch(statements.slice(offset, offset + 100));
      return { claimIds, created, reused: claims.length - created };
    } catch (error) {
      // A ledger_ref collision rolls the whole batch back; build it again with fresh references.
      if (round < 4 && /ledger_ref/i.test(error instanceof Error ? error.message : "")) continue;
      throw error;
    }
  }
  throw new Error("unreachable");
}

/* ---------- S4c: extract one chunk ---------- */

export interface ExtractDeps {
  db: D1Database;
  complete: ExtractComplete;
  poolTopicId: string;
  promptVersion?: string;
  headwords?: HeadwordIndex;
  runId?: string | null;
  /** Where snapshot bodies live; chunk text is read from here, never from D1. */
  objects?: LedgerObjectStore;
  now?: () => number;
}

export interface QueuedChunk { chunkHash: string; chunkId: string; sourceId: string; attempts: number; servedBy: string | null; text: string; sourceUrl: string; sourceTitle: string }

export type ChunkOutcome =
  | { status: "succeeded"; claimIds: string[]; calls: number }
  | { status: "empty" | "failed" | "exhausted"; claimIds: []; calls: number; error: string };

const callPieces = (text: string) => (text.length > MAX_CALL_CHARS ? chunkLedgerText(text) : [text]);

export function splitInHalf(text: string): string[] {
  if (text.length < 200) return [text];
  const middle = Math.floor(text.length / 2);
  const reach = Math.floor(text.length * 0.2);
  let cut = middle;
  for (let distance = 0; distance <= reach; distance += 1) {
    const left = text[middle - distance];
    const right = text[middle + distance];
    if (left === "。" || left === "\n" || left === ".") { cut = middle - distance + 1; break; }
    if (right === "。" || right === "\n" || right === ".") { cut = middle + distance + 1; break; }
  }
  return [text.slice(0, cut), text.slice(cut)].map((part) => part.trim()).filter(Boolean);
}

async function saveExtraction(
  db: D1Database,
  chunk: QueuedChunk,
  promptVersion: string,
  fields: { status: string; raw: number; verified: number; attempts: number; error: string | null; servedBy: string | null },
  now: number,
) {
  await db.prepare(
    `INSERT INTO hubpedia_ledger_extractions (chunk_hash, prompt_version, chunk_id, source_id, status, raw_claims, verified_claims, attempts, last_error, served_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chunk_hash, prompt_version) DO UPDATE SET status = excluded.status, raw_claims = excluded.raw_claims,
       verified_claims = excluded.verified_claims, attempts = excluded.attempts, last_error = excluded.last_error,
       served_by = excluded.served_by, updated_at = excluded.updated_at`,
  ).bind(chunk.chunkHash, promptVersion, chunk.chunkId, chunk.sourceId, fields.status, fields.raw, fields.verified, fields.attempts, fields.error, fields.servedBy, now).run();
}

const errorText = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : "unknown error").replace(/\s+/g, " ").slice(0, 200);

/**
 * Runs up to three attempts on one chunk, starting after the attempts already recorded.
 *   attempt 1: the chunk as is; attempt 2: the chunk cut in half (two calls); attempt 3: the whole chunk on another provider.
 *   If attempt 3 was served by the same provider (none other available), attempt 4 retries once more with the chunk cut
 *   in quarters (a different split). Then the chunk is `exhausted` and the run goes on; one chunk never blocks it.
 * ChainExhaustedError propagates with the row untouched, so the next run resumes at the same attempt.
 */
export function extractChunk(chunk: QueuedChunk, deps: ExtractDeps): Promise<ChunkOutcome> {
  return timed("extract-chunk", () => extractChunkUntimed(chunk, deps), { chars: chunk.text.length });
}

async function extractChunkUntimed(chunk: QueuedChunk, deps: ExtractDeps): Promise<ChunkOutcome> {
  const promptVersion = deps.promptVersion ?? LEDGER_PROMPT_VERSION;
  const clock = deps.now ?? nowSeconds;
  const verifyTarget: FactoryResearchChunk = { id: chunk.chunkId, sourceUrl: chunk.sourceUrl, sourceTitle: chunk.sourceTitle, textContent: chunk.text };
  let attempts = chunk.attempts;
  let servedBy = chunk.servedBy;
  let calls = 0;
  let lastError = "";
  let lastStatus: "empty" | "failed" = "empty";
  let lastExhausted = false;

  while (attempts < LEDGER_MAX_ATTEMPTS) {
    const attempt = attempts + 1;
    const parts = attempt === 2
      ? splitInHalf(chunk.text).flatMap(callPieces)
      : attempt === 4 ? splitInHalf(chunk.text).flatMap(splitInHalf).flatMap(callPieces) : callPieces(chunk.text);
    const exclude = attempt === 3 && servedBy ? [servedBy] : [];
    const providerBefore = servedBy;
    /** True when this attempt ends the chunk: the limit, or attempt 3 that did switch provider. */
    const isLast = (served: string | null) => attempt >= LEDGER_MAX_ATTEMPTS || (attempt === 3 && (!providerBefore || served !== providerBefore));
    let raw = 0;
    const modelClaims: ModelClaim[] = [];
    let attemptServedBy = servedBy;
    try {
      for (const [index, part] of parts.entries()) {
        const cacheKey = sha256Hex(`${chunk.chunkHash}|${promptVersion}|a${attempt}|p${index}|x${exclude.join(",")}`);
        const served = await deps.complete(buildCall(part, chunk.sourceTitle), { cacheKey, excludeProviders: exclude });
        calls += 1;
        attemptServedBy = served.servedBy;
        if (!served.cached) await recordAiCall(deps.db, deps.runId ?? null, { servedBy: served.servedBy, tokens: served.tokens, chunkHash: chunk.chunkHash, attempt, status: "succeeded" });
        const parsed = parseModelClaims(served.output);
        raw += parsed.raw;
        modelClaims.push(...parsed.claims);
      }
    } catch (error) {
      if (error instanceof ChainExhaustedError) throw error;
      attempts = attempt;
      lastStatus = "failed";
      lastError = errorText(error);
      servedBy = attemptServedBy;
      const exhausted = isLast(attemptServedBy);
      lastExhausted = exhausted;
      await saveExtraction(deps.db, chunk, promptVersion, { status: exhausted ? "exhausted" : "failed", raw: 0, verified: 0, attempts, error: lastError, servedBy }, clock());
      if (exhausted) break;
      continue;
    }

    attempts = attempt;
    servedBy = attemptServedBy;
    const verified = verifyAgainstChunk(verifyTarget, modelClaims);
    if (verified.length > 0) {
      const stored = await storeClaims(deps.db, {
        chunkId: chunk.chunkId, chunkHash: chunk.chunkHash, promptVersion, poolTopicId: deps.poolTopicId, claims: verified,
        headwords: deps.headwords, extraction: { raw, attempts, servedBy }, now: clock(),
      });
      return { status: "succeeded", claimIds: stored.claimIds, calls };
    }
    lastStatus = "empty";
    lastError = raw === 0 ? "empty: model returned no claims" : "empty: no claim had a verbatim quote";
    const exhausted = isLast(servedBy);
    lastExhausted = exhausted;
    await saveExtraction(deps.db, chunk, promptVersion, { status: exhausted ? "exhausted" : "empty", raw, verified: 0, attempts, error: lastError, servedBy }, clock());
    if (exhausted) break;
  }
  return { status: lastExhausted ? "exhausted" : lastStatus, claimIds: [], calls, error: lastError };
}

/* ---------- S4d: the extraction loop ---------- */

export interface ExtractRunSummary {
  chunksTried: number; succeeded: number; empty: number; failed: number; exhausted: number; modelCalls: number;
  claimIds: string[]; stoppedByChain: boolean; nextAvailableAt: number | null; filePending?: number;
  /** Queued chunks whose snapshot body was missing or failed its hash check; left pending, not sent to a model. */
  unreadable: number;
}

const WORK_STATUSES = "('pending','empty','failed')";

/** A queued row whose body could not be read or verified: left untouched (still pending) and counted. */
export interface UnreadableChunk { chunkHash: string; chunkId: string; reason: string }

export async function loadQueue(
  db: D1Database,
  options: { promptVersion?: string; afterHash?: string; limit?: number; objects?: LedgerObjectStore; reader?: SnapshotReader; unreadable?: UnreadableChunk[]; /** Only chunks of these sources (the unattended runner works one topic at a time). */ sourceIds?: readonly string[] },
): Promise<QueuedChunk[]> {
  const reader = options.reader ?? new SnapshotReader(options.objects);
  const { results: rows } = await db.prepare(
    `SELECT e.chunk_hash AS chunkHash, e.chunk_id AS chunkId, e.source_id AS sourceId, e.attempts AS attempts, e.served_by AS servedBy,
            ${chunkLocatorColumns("c", "sn")}, s.url AS sourceUrl, COALESCE(s.title, s.url) AS sourceTitle
     FROM hubpedia_ledger_extractions e
     JOIN encyclopedia_source_chunks c ON c.id = e.chunk_id
     JOIN encyclopedia_source_snapshots sn ON sn.id = c.snapshot_id
     JOIN encyclopedia_sources s ON s.id = e.source_id
     WHERE e.prompt_version = ? AND e.status IN ${WORK_STATUSES} AND e.attempts < ? AND e.chunk_hash > ?${options.sourceIds ? ` AND e.source_id IN (${options.sourceIds.map(() => "?").join(",") || "NULL"})` : ""}
     ORDER BY e.chunk_hash LIMIT ?`,
  ).bind(options.promptVersion ?? LEDGER_PROMPT_VERSION, LEDGER_MAX_ATTEMPTS, options.afterHash ?? "", ...(options.sourceIds ?? []), options.limit ?? 200).all<Omit<QueuedChunk, "text"> & ChunkLocator>();
  const queue: QueuedChunk[] = [];
  for (const row of rows) {
    try {
      const text = await reader.chunkText(row);
      queue.push({ chunkHash: row.chunkHash, chunkId: row.chunkId, sourceId: row.sourceId, attempts: row.attempts, servedBy: row.servedBy, text, sourceUrl: row.sourceUrl, sourceTitle: row.sourceTitle });
    } catch (error) {
      if (!(error instanceof LedgerObjectError)) throw error;
      options.unreadable?.push({ chunkHash: row.chunkHash, chunkId: row.chunkId, reason: error.code });
    }
  }
  return queue;
}

/**
 * Extracts every queued chunk (or up to `maxChunks`). Returns normally when the provider chain is exhausted;
 * the remaining rows are still pending and the same command continues next time.
 */
export async function runExtraction(deps: ExtractDeps, options: { maxChunks?: number } = {}): Promise<ExtractRunSummary> {
  const summary: ExtractRunSummary = { chunksTried: 0, succeeded: 0, empty: 0, failed: 0, exhausted: 0, modelCalls: 0, claimIds: [], stoppedByChain: false, nextAvailableAt: null, unreadable: 0 };
  const budget = options.maxChunks ?? Number.POSITIVE_INFINITY;
  let after = "";
  const reader = new SnapshotReader(deps.objects);
  while (summary.chunksTried < budget) {
    const unreadable: UnreadableChunk[] = [];
    const queue = await loadQueue(deps.db, { promptVersion: deps.promptVersion, afterHash: after, limit: Math.min(200, budget - summary.chunksTried), reader, unreadable });
    summary.unreadable += unreadable.length;
    const unreadableEnd = unreadable.length ? unreadable[unreadable.length - 1].chunkHash : "";
    if (unreadableEnd > after) after = unreadableEnd;
    if (!queue.length) { if (unreadable.length) continue; break; }
    for (const chunk of queue) {
      after = chunk.chunkHash;
      try {
        const outcome = await extractChunk(chunk, deps);
        summary.chunksTried += 1;
        summary.modelCalls += outcome.calls;
        if (outcome.status === "succeeded") { summary.succeeded += 1; summary.claimIds.push(...outcome.claimIds); }
        else summary[outcome.status] += 1;
        if (outcome.status === "succeeded") {
          const siblings = await deps.db.prepare("SELECT id FROM encyclopedia_source_chunks WHERE content_hash = ? AND id <> ?").bind(chunk.chunkHash, chunk.chunkId).all<{ id: string }>();
          for (const sibling of siblings.results) await copyEvidenceBetweenChunks(deps.db, chunk.chunkId, sibling.id);
        }
      } catch (error) {
        // File provider: the request was written for a person to answer; leave the row pending and go on to the next chunk.
        if (error instanceof FilePendingError) { summary.filePending = (summary.filePending ?? 0) + 1; continue; }
        if (error instanceof ChainExhaustedError) {
          summary.stoppedByChain = true;
          summary.nextAvailableAt = error.nextAvailableAt;
          return summary;
        }
        throw error;
      }
    }
    if (unreadableEnd > after) after = unreadableEnd;
  }
  return summary;
}

/* ---------- reporting ---------- */

export interface SourceExtractionSummary {
  sourceId: string; url: string; succeeded: number; empty: number; failed: number; exhausted: number; skipped: number; pending: number;
  verifiedClaims: number; zeroClaims: boolean;
}

/**
 * Per-source counts for the run record. A source whose finished chunks produced no verified claims is flagged
 * `zeroClaims`, so it shows up in the list and is never counted as "has sources" by default.
 */
export async function summarizeSources(db: D1Database, options: { promptVersion?: string; sourceIds?: string[] } = {}): Promise<SourceExtractionSummary[]> {
  const promptVersion = options.promptVersion ?? LEDGER_PROMPT_VERSION;
  const filter = options.sourceIds?.length ? `AND e.source_id IN (${options.sourceIds.map(() => "?").join(",")})` : "";
  const { results } = await db.prepare(
    `SELECT e.source_id AS sourceId, s.url AS url,
       SUM(e.status = 'succeeded') AS succeeded, SUM(e.status = 'empty') AS empty, SUM(e.status = 'failed') AS failed,
       SUM(e.status = 'exhausted') AS exhausted, SUM(e.status = 'skipped') AS skipped, SUM(e.status = 'pending') AS pending,
       SUM(e.verified_claims) AS verifiedClaims
     FROM hubpedia_ledger_extractions e JOIN encyclopedia_sources s ON s.id = e.source_id
     WHERE e.prompt_version = ? ${filter}
     GROUP BY e.source_id, s.url ORDER BY e.source_id`,
  ).bind(promptVersion, ...(options.sourceIds ?? [])).all<Omit<SourceExtractionSummary, "zeroClaims">>();
  return results.map((row) => ({
    ...row,
    succeeded: Number(row.succeeded), empty: Number(row.empty), failed: Number(row.failed), exhausted: Number(row.exhausted),
    skipped: Number(row.skipped), pending: Number(row.pending), verifiedClaims: Number(row.verifiedClaims ?? 0),
    zeroClaims: Number(row.verifiedClaims ?? 0) === 0 && Number(row.pending) === 0,
  }));
}

export { getLedgerPoolTopicId };
export type { ProviderId };
