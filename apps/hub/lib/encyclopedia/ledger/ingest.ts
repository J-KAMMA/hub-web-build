import { createHash, randomUUID } from "node:crypto";

import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import { chunkText } from "../chunk";
import { extractHtml } from "../extract";
import { fetchSource } from "../fetcher";
import { sourceText } from "../source-text";
import { assertSafeUrl, normalizeSourceUrl } from "../url-security";
import { findTrustedSourceDomain } from "../trusted-source-domains";
import { putSnapshotBody, type LedgerObjectStore } from "./object-store";
import { admitLedgerUrl, type LedgerAdmission, type LedgerFeed, type TrustedLookup } from "./feeds";
import { timed } from "./stage-log";

/*
 * Stages S1 to S3 of the Hubpedia ledger (docs/hubpedia-ledger.md section 2):
 * discover pages, snapshot them, cut the snapshot into chunks. No model is
 * called. Sources and chunks go into the shared pool topic, so a page is read
 * once whichever topic later uses it.
 *
 * Every read here is keyed (cursor, unique index, due time). Nothing pages by
 * skipping rows.
 */

export const LEDGER_TOPIC_ID = "ledger-pool";
export const LEDGER_INGEST_VERSION = "ledger-ingest-v1";
/** About 2,000 characters a chunk, 200 of overlap inside an over-long section. */
export const LEDGER_CHUNKING = { maxChars: 2000, overlapChars: 200, maxChunksPerSource: 200 } as const;
export const LEDGER_FETCH = { timeoutMs: 20_000, maxBytes: 8_000_000 } as const;
const STATEMENTS_PER_BATCH = 100;
const FAILURE_RETRY_SECONDS = 24 * 3600;
const WEB_MIN_CHARS = 400;
const ABSTRACT_MIN_CHARS = 200;
export const LEDGER_ANALYZE_THRESHOLD = 200;

export interface FetchedPage {
  url: string;
  mimeType: string;
  text: string;
  title: string | null;
  language: string | null;
  publishedAt: Date | null;
  authors: string[];
  headings: string[];
}

export interface IngestDeps {
  db: D1Database;
  fetchPage: (url: string) => Promise<FetchedPage>;
  fetchText: (url: string) => Promise<string>;
  fetchJson: (url: string) => Promise<unknown>;
  lookup?: TrustedLookup;
  /** Where snapshot bodies are written (R2 or a local directory). Required for storing pages; D1 keeps no body text. */
  objects?: LedgerObjectStore;
  now?: () => number;
  newId?: () => string;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const nowSeconds = (deps: IngestDeps) => Math.floor((deps.now?.() ?? Date.now()) / 1000);
const newId = (deps: IngestDeps) => (deps.newId ?? randomUUID)();

/* ---------- text and chunks ---------- */

export function normalizePageText(text: string) {
  return text.replace(/\r\n?/gu, "\n").trim();
}

export type PageClass = "ok" | "too-short" | "table-only";

/** Pages that are only a table or a few lines carry nothing a claim can be quoted from. */
export function classifyPageText(text: string, minChars = WEB_MIN_CHARS): PageClass {
  const compact = text.replace(/\s+/gu, "");
  if (compact.length < minChars) return "too-short";
  const digits = compact.replace(/[^0-9]/gu, "").length;
  if (digits / compact.length > 0.45) return "table-only";
  return "ok";
}

export interface LedgerChunk {
  chunkIndex: number;
  headingPath: string[];
  textContent: string;
  startOffset: number;
  endOffset: number;
  contentHash: string;
}

/**
 * Cuts text into chunks of at most LEDGER_CHUNKING.maxChars, preferring the
 * boundaries of headings: short sections are packed together, a section longer
 * than a chunk is cut by chunkText. Deterministic, so the same text yields the
 * same chunks and the same content hashes on every run.
 */
export function chunkLedgerText(text: string, headings: readonly string[] = []): LedgerChunk[] {
  const max = LEDGER_CHUNKING.maxChars;
  const starts: Array<{ at: number; heading: string | null }> = [{ at: 0, heading: null }];
  let from = 0;
  for (const heading of headings) {
    if (!heading) continue;
    let at = text.indexOf(heading, from);
    while (at !== -1) {
      const lineStart = at === 0 || text[at - 1] === "\n";
      const lineEnd = at + heading.length >= text.length || text[at + heading.length] === "\n";
      if (lineStart && lineEnd) break;
      at = text.indexOf(heading, at + 1);
    }
    if (at === -1) continue;
    if (at > 0) starts.push({ at, heading });
    else starts[0].heading = heading;
    from = at + heading.length;
  }
  const sections = starts.map((entry, index) => ({
    start: entry.at,
    end: index + 1 < starts.length ? starts[index + 1].at : text.length,
    heading: entry.heading,
  }));

  const raw: Array<{ start: number; end: number; heading: string | null }> = [];
  let pack: { start: number; end: number; heading: string | null } | null = null;
  const flush = () => {
    if (pack) raw.push(pack);
    pack = null;
  };
  for (const section of sections) {
    const length = section.end - section.start;
    if (length > max) {
      flush();
      for (const piece of chunkText(text.slice(section.start, section.end), max / 4, LEDGER_CHUNKING.overlapChars / 4)) {
        raw.push({ start: section.start + piece.startOffset, end: section.start + piece.endOffset, heading: section.heading });
      }
    } else if (pack && section.end - pack.start <= max) {
      pack.end = section.end;
    } else {
      flush();
      pack = { start: section.start, end: section.end, heading: section.heading };
    }
  }
  flush();

  const chunks: LedgerChunk[] = [];
  for (const piece of raw) {
    const slice = text.slice(piece.start, piece.end);
    const content = slice.trim();
    if (!content) continue;
    const start = piece.start + slice.indexOf(content);
    chunks.push({
      chunkIndex: chunks.length,
      headingPath: piece.heading ? [piece.heading] : [],
      textContent: content,
      startOffset: start,
      endOffset: start + content.length,
      contentHash: sha256(content),
    });
    if (chunks.length >= LEDGER_CHUNKING.maxChunksPerSource) break;
  }
  return chunks;
}

/* ---------- default network access ---------- */

async function boundedGet(url: string, accept: string): Promise<string> {
  let current = (await assertSafeUrl(url)).toString();
  for (let hop = 0; hop < 4; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LEDGER_FETCH.timeoutMs);
    try {
      const response = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { accept, "user-agent": "WorldGovernmentHub-Encyclopedia/1.0" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect without location.");
        current = (await assertSafeUrl(new URL(location, current).toString())).toString();
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > LEDGER_FETCH.maxBytes) throw new Error("Response too large.");
      return body;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects.");
}

export async function defaultFetchPage(url: string): Promise<FetchedPage> {
  const fetched = await fetchSource(url, LEDGER_FETCH);
  const mime = fetched.mimeType.split(";")[0].trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    const doc = extractHtml(new TextDecoder().decode(fetched.body), fetched.finalUrl);
    const published = doc.publishedAt ? new Date(doc.publishedAt) : null;
    return {
      url: fetched.finalUrl,
      mimeType: mime,
      text: doc.text,
      title: doc.title,
      language: doc.language,
      publishedAt: published && Number.isFinite(published.getTime()) ? published : null,
      authors: doc.authors,
      headings: doc.headings.map((entry) => entry.text),
    };
  }
  return { url: fetched.finalUrl, mimeType: mime, text: sourceText(fetched), title: null, language: null, publishedAt: null, authors: [], headings: [] };
}

export const defaultFetchText = (url: string) => boundedGet(url, "application/xml,text/xml,text/plain");
export const defaultFetchJson = async (url: string) => JSON.parse(await boundedGet(url, "application/json")) as unknown;

export function defaultIngestDeps(db: D1Database, objects?: LedgerObjectStore): IngestDeps {
  return { db, objects, fetchPage: defaultFetchPage, fetchText: defaultFetchText, fetchJson: defaultFetchJson };
}

/* ---------- storing one page (S2 and S3) ---------- */

export type PageOutcome =
  | { outcome: "new-snapshot"; sourceId: string; snapshotId: string; chunks: number; relocated: number; lost: number; affectedClaimIds: string[] }
  | { outcome: "unchanged" | "skipped" | "rejected" | "failed"; reason?: string };

interface StoreInput {
  feed: LedgerFeed;
  admission: Extract<LedgerAdmission, { admitted: true }>;
  url: string;
  title: string | null;
  language: string | null;
  publishedAt: Date | null;
  authors: string[];
  doi?: string | null;
  mimeType: string;
  text: string;
  headings: string[];
  minChars: number;
  extraMetadata?: Record<string, unknown>;
}

async function runStatements(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += STATEMENTS_PER_BATCH) {
    await db.batch(statements.slice(index, index + STATEMENTS_PER_BATCH));
  }
}

function sourceMetadata(input: StoreInput, extra: Record<string, unknown>) {
  return JSON.stringify({
    ...input.admission.metadata,
    ...(input.extraMetadata ?? {}),
    ledger: { feedId: input.feed.id, ingestVersion: LEDGER_INGEST_VERSION, ...extra },
  });
}

/** Insert the source when new, otherwise refresh it. Returns the id. */
async function upsertSourceStatement(deps: IngestDeps, input: StoreInput, extra: Record<string, unknown>, nextCheckAt: number) {
  const url = normalizeSourceUrl(input.url);
  const now = nowSeconds(deps);
  const existing = await deps.db
    .prepare("SELECT id FROM encyclopedia_sources WHERE topic_id = ?1 AND normalized_url = ?2")
    .bind(LEDGER_TOPIC_ID, url)
    .first<{ id: string }>();
  const sourceId = existing?.id ?? newId(deps);
  const published = input.publishedAt ? Math.floor(input.publishedAt.getTime() / 1000) : null;
  const statement = existing
    ? deps.db
        .prepare(
          "UPDATE encyclopedia_sources SET title = coalesce(?2, title), language = coalesce(?3, language), published_at = coalesce(?4, published_at), authors = ?5, license = ?6, reliability_tier = ?7, metadata = ?8, feed_id = ?9, next_check_at = ?10, updated_at = ?11 WHERE id = ?1",
        )
        .bind(sourceId, input.title, input.language, published, JSON.stringify(input.authors), input.admission.license, input.feed.reliabilityTier, sourceMetadata(input, extra), input.feed.id, nextCheckAt, now)
    : deps.db
        .prepare(
          "INSERT INTO encyclopedia_sources (id, topic_id, url, normalized_url, title, publisher, authors, source_type, language, doi, isbn, published_at, license, reliability_tier, metadata, is_active, created_at, updated_at, feed_id, next_check_at) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?12, ?13, 1, ?14, ?14, ?15, ?16)",
        )
        .bind(sourceId, LEDGER_TOPIC_ID, url, input.title, input.admission.trusted.publisher, JSON.stringify(input.authors), input.feed.sourceType, input.language, input.doi ?? null, published, input.admission.license, input.feed.reliabilityTier, sourceMetadata(input, extra), now, input.feed.id, nextCheckAt);
  return { sourceId, statement, isNew: !existing };
}

interface LiveEvidence {
  claim_id: string;
  chunk_id: string;
  stance: string;
  quote: string | null;
  relevance: number | null;
  metadata: string;
  content_hash: string | null;
}

export async function storePage(deps: IngestDeps, input: StoreInput): Promise<PageOutcome> {
  const now = nowSeconds(deps);
  const text = normalizePageText(input.text);
  const recheck = now + input.feed.recheckDays * 86400;
  const kind = classifyPageText(text, input.minChars);
  if (kind !== "ok") {
    const { statement } = await upsertSourceStatement(deps, input, { skipped: kind }, recheck);
    await statement.run();
    return { outcome: "skipped", reason: kind };
  }

  const contentHash = sha256(text);
  if (!deps.objects) throw new Error("storePage needs an object store (deps.objects); snapshot bodies are not kept in D1.");
  const { sourceId, statement: sourceStatement } = await upsertSourceStatement(deps, input, {}, recheck);
  const snapshot = await deps.db
    .prepare("SELECT id, extraction_status FROM encyclopedia_source_snapshots WHERE source_id = ?1 AND content_hash = ?2")
    .bind(sourceId, contentHash)
    .first<{ id: string; extraction_status: string }>();
  if (snapshot?.extraction_status === "succeeded") {
    await sourceStatement.run();
    return { outcome: "unchanged" };
  }

  const snapshotId = snapshot?.id ?? newId(deps);
  // The body goes to the object store first (immutable, keyed by hash, deduplicated). An orphan object after a failed D1 write is harmless.
  const body = await putSnapshotBody(deps.objects, text);
  const chunks = chunkLedgerText(text, input.headings).map((chunk) => ({ ...chunk, id: newId(deps) }));
  const evidence = (
    await deps.db
      .prepare(
        "SELECT e.claim_id, e.chunk_id, e.stance, e.quote, e.relevance, e.metadata, c.content_hash FROM encyclopedia_claim_evidence e JOIN encyclopedia_source_chunks c ON c.id = e.chunk_id JOIN encyclopedia_source_snapshots s ON s.id = c.snapshot_id WHERE s.source_id = ?1 AND s.id <> ?2 AND e.superseded_at IS NULL",
      )
      .bind(sourceId, snapshotId)
      .all<LiveEvidence>()
  ).results;

  const statements: D1PreparedStatement[] = [sourceStatement];
  if (snapshot) {
    // An interrupted earlier attempt: its partial chunks carry no evidence yet.
    statements.push(deps.db.prepare("DELETE FROM encyclopedia_source_chunks WHERE snapshot_id = ?1").bind(snapshotId));
    statements.push(deps.db.prepare("UPDATE encyclopedia_source_snapshots SET body_object_key = ?2, body_sha256 = ?3, body_bytes = ?4 WHERE id = ?1").bind(snapshotId, body.key, body.sha256, body.bytes));
  } else {
    statements.push(
      deps.db
        .prepare(
          "INSERT INTO encyclopedia_source_snapshots (id, source_id, retrieved_at, content_hash, mime_type, extracted_text, extraction_status, extraction_metadata, canonical_url, extracted_title, extracted_language, extracted_authors, extracted_published_at, created_at, body_object_key, body_sha256, body_bytes) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'pending', ?6, ?7, ?8, ?9, ?10, ?11, ?3, ?12, ?13, ?14)",
        )
        .bind(snapshotId, sourceId, now, contentHash, input.mimeType, JSON.stringify({ textLength: text.length, chunks: chunks.length, ingestVersion: LEDGER_INGEST_VERSION }), normalizeSourceUrl(input.url), input.title, input.language, JSON.stringify(input.authors), input.publishedAt ? Math.floor(input.publishedAt.getTime() / 1000) : null, body.key, body.sha256, body.bytes),
    );
  }
  for (const chunk of chunks) {
    statements.push(
      deps.db
        .prepare("INSERT INTO encyclopedia_source_chunks (id, snapshot_id, chunk_index, heading_path, text_content, start_offset, end_offset, metadata, created_at, content_hash) VALUES (?1, ?2, ?3, ?4, '', ?5, ?6, '{}', ?7, ?8)")
        .bind(chunk.id, snapshotId, chunk.chunkIndex, JSON.stringify(chunk.headingPath), chunk.startOffset, chunk.endOffset, now, chunk.contentHash),
    );
  }

  // Carry the evidence of the earlier snapshots forward (no model involved).
  const byHash = new Map(chunks.map((chunk) => [chunk.contentHash, chunk]));
  const lost = new Set<string>();
  const relocated = new Set<string>();
  for (const row of evidence) {
    const same = row.content_hash ? byHash.get(row.content_hash) : undefined;
    const target = same ?? (row.quote ? chunks.find((chunk) => chunk.textContent.includes(row.quote as string)) : undefined);
    if (target) {
      if (!same) relocated.add(row.claim_id);
      statements.push(
        deps.db
          .prepare("INSERT OR IGNORE INTO encyclopedia_claim_evidence (claim_id, chunk_id, stance, quote, relevance, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
          .bind(row.claim_id, target.id, row.stance, row.quote, row.relevance, row.metadata, now),
      );
    } else {
      lost.add(row.claim_id);
    }
    statements.push(deps.db.prepare("UPDATE encyclopedia_claim_evidence SET superseded_at = ?3 WHERE claim_id = ?1 AND chunk_id = ?2").bind(row.claim_id, row.chunk_id, now));
  }
  for (const claimId of lost) {
    // A claim with no live supporting evidence left is no longer usable in an article.
    statements.push(
      deps.db
        .prepare(
          "UPDATE encyclopedia_claims SET status = 'proposed', updated_at = ?2 WHERE id = ?1 AND status = 'supported' AND NOT EXISTS (SELECT 1 FROM encyclopedia_claim_evidence WHERE claim_id = ?1 AND stance = 'supports' AND superseded_at IS NULL)",
        )
        .bind(claimId, now),
    );
  }

  statements.push(deps.db.prepare("UPDATE encyclopedia_source_snapshots SET extraction_status = 'succeeded' WHERE id = ?1").bind(snapshotId));
  statements.push(
    deps.db
      .prepare("INSERT OR IGNORE INTO encyclopedia_pipeline_runs (id, source_id, run_type, status, input, output, idempotency_key, started_at, completed_at, created_at, updated_at) VALUES (?1, ?2, 'ledger.snapshot', 'succeeded', ?3, ?4, ?5, ?6, ?6, ?6, ?6)")
      .bind(newId(deps), sourceId, JSON.stringify({ url: normalizeSourceUrl(input.url), contentHash }), JSON.stringify({ chunks: chunks.length, relocated: relocated.size, lost: lost.size }), `ledger-snapshot:${sourceId}:${contentHash}:${LEDGER_INGEST_VERSION}`, now),
  );

  await runStatements(deps.db, statements);
  return { outcome: "new-snapshot", sourceId, snapshotId, chunks: chunks.length, relocated: relocated.size, lost: lost.size, affectedClaimIds: [...new Set([...relocated, ...lost])] };
}

/* ---------- one URL ---------- */

async function recordFailure(deps: IngestDeps, feed: LedgerFeed, admission: Extract<LedgerAdmission, { admitted: true }>, url: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 300) : "fetch failed";
  const { statement } = await upsertSourceStatement(
    deps,
    { feed, admission, url, title: null, language: null, publishedAt: null, authors: [], mimeType: "", text: "", headings: [], minChars: 0 },
    { lastError: message },
    nowSeconds(deps) + FAILURE_RETRY_SECONDS,
  );
  await statement.run();
}

export async function processLedgerUrl(deps: IngestDeps, feed: LedgerFeed, rawUrl: string): Promise<PageOutcome> {
  let url: string;
  try {
    url = normalizeSourceUrl(rawUrl);
  } catch {
    return { outcome: "rejected", reason: "invalid-url" };
  }
  const admission = admitLedgerUrl(feed, url, deps.lookup);
  if (!admission.admitted) return { outcome: "rejected", reason: admission.reason };
  let page: FetchedPage;
  try {
    page = await timed("fetch", () => deps.fetchPage(url), { host: new URL(url).hostname });
  } catch (error) {
    await recordFailure(deps, feed, admission, url, error);
    return { outcome: "failed", reason: error instanceof Error ? error.message.slice(0, 200) : "fetch failed" };
  }
  let finalUrl: string;
  try {
    finalUrl = normalizeSourceUrl(page.url);
  } catch {
    return { outcome: "rejected", reason: "invalid-final-url" };
  }
  let finalAdmission = admission;
  if (finalUrl !== url) {
    const again = admitLedgerUrl(feed, finalUrl, deps.lookup);
    if (!again.admitted) return { outcome: "rejected", reason: `redirect-${again.reason}` };
    finalAdmission = again;
  }
  return timed("ingest-store", () => storePage(deps, { feed, admission: finalAdmission, url: finalUrl, title: page.title, language: page.language, publishedAt: page.publishedAt, authors: page.authors, mimeType: page.mimeType, text: page.text, headings: page.headings, minChars: WEB_MIN_CHARS }), { chars: page.text.length });
}

/* ---------- discovery (S1) ---------- */

function decodeXml(value: string) {
  return value.replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'");
}

export function parseSitemapLocs(xml: string) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gu)].map((match) => decodeXml(match[1]));
}

export async function discoverSitemapUrls(deps: IngestDeps, feed: LedgerFeed): Promise<string[]> {
  if (feed.discovery.type !== "sitemap") return [];
  const { include, exclude, url } = feed.discovery;
  const root = await deps.fetchText(url);
  let locs = parseSitemapLocs(root);
  if (/<sitemapindex/u.test(root)) {
    const nested: string[] = [];
    for (const child of locs.slice(0, 20)) nested.push(...parseSitemapLocs(await deps.fetchText(child)));
    locs = nested;
  }
  const found = new Set<string>();
  for (const loc of locs) {
    let normalized: string;
    let path: string;
    try {
      normalized = normalizeSourceUrl(loc);
      path = new URL(normalized).pathname.replace(/\/$/u, "") || "/";
    } catch {
      continue;
    }
    if (!include.some((rule) => rule.test(path)) || exclude.some((rule) => rule.test(path))) continue;
    found.add(normalized);
  }
  return [...found].sort();
}

export function discoverFixedUrls(feed: LedgerFeed): string[] {
  if (feed.discovery.type !== "urls") return [];
  const found = new Set<string>();
  for (const url of feed.discovery.urls) {
    try {
      found.add(normalizeSourceUrl(url));
    } catch {
      /* invalid seed */
    }
  }
  return [...found].sort();
}

async function readCursor(db: D1Database, feedId: string) {
  const row = await db.prepare("SELECT cursor FROM hubpedia_ledger_feed_cursors WHERE feed_id = ?1").bind(feedId).first<{ cursor: string }>();
  return row?.cursor ?? "";
}

async function writeCursor(deps: IngestDeps, feedId: string, cursor: string) {
  await deps.db
    .prepare("INSERT INTO hubpedia_ledger_feed_cursors (feed_id, cursor, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(feed_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at")
    .bind(feedId, cursor, nowSeconds(deps))
    .run();
}

export interface FeedRunResult {
  feedId: string;
  status: "ran" | "skipped";
  reason?: string;
  cursorBefore: string;
  cursorAfter: string;
  exhausted: boolean;
  fetched: number;
  newSnapshots: number;
  unchanged: number;
  skipped: number;
  rejected: number;
  failed: number;
  chunksInserted: number;
  bibliographicOnly: number;
  affectedClaimIds: string[];
}

const emptyResult = (feedId: string, cursor: string): FeedRunResult => ({
  feedId, status: "ran", cursorBefore: cursor, cursorAfter: cursor, exhausted: false, fetched: 0, newSnapshots: 0, unchanged: 0, skipped: 0, rejected: 0, failed: 0, chunksInserted: 0, bibliographicOnly: 0, affectedClaimIds: [],
});

function tally(result: FeedRunResult, outcome: PageOutcome) {
  if (outcome.outcome === "new-snapshot") {
    result.newSnapshots += 1;
    result.chunksInserted += outcome.chunks;
    result.affectedClaimIds.push(...outcome.affectedClaimIds);
  } else if (outcome.outcome === "unchanged") result.unchanged += 1;
  else if (outcome.outcome === "skipped") result.skipped += 1;
  else if (outcome.outcome === "rejected") result.rejected += 1;
  else result.failed += 1;
}

async function recordDiscoverRun(deps: IngestDeps, feed: LedgerFeed, result: FeedRunResult) {
  const now = nowSeconds(deps);
  await deps.db
    .prepare("INSERT OR IGNORE INTO encyclopedia_pipeline_runs (id, run_type, status, input, output, idempotency_key, started_at, completed_at, created_at, updated_at) VALUES (?1, 'ledger.discover', 'succeeded', ?2, ?3, ?4, ?5, ?5, ?5, ?5)")
    .bind(newId(deps), JSON.stringify({ feedId: feed.id, cursorBefore: result.cursorBefore }), JSON.stringify({ cursorAfter: result.cursorAfter, fetched: result.fetched, newSnapshots: result.newSnapshots, failed: result.failed, rejected: result.rejected }), `ledger-discover:${feed.id}:${sha256(result.cursorBefore).slice(0, 16)}:${LEDGER_INGEST_VERSION}:${now}`, now)
    .run();
}

/** True when a feed may run at all: enabled, and its publisher has a review record. */
export function feedRunnable(feed: LedgerFeed, lookup: TrustedLookup = findTrustedSourceDomain): { ok: true } | { ok: false; reason: string } {
  if (feed.status !== "enabled") return { ok: false, reason: "awaiting-review" };
  if (!lookup(`https://${feed.publisherDomain}/`)) return { ok: false, reason: "publisher-not-reviewed" };
  return { ok: true };
}

async function dueMap(db: D1Database, urls: string[]) {
  const due = new Map<string, number | null>();
  const placeholders = urls.map((_, index) => `?${index + 2}`).join(",");
  const rows = await db
    .prepare(`SELECT normalized_url, next_check_at FROM encyclopedia_sources WHERE topic_id = ?1 AND normalized_url IN (${placeholders})`)
    .bind(LEDGER_TOPIC_ID, ...urls)
    .all<{ normalized_url: string; next_check_at: number | null }>();
  for (const row of rows.results) due.set(row.normalized_url, row.next_check_at);
  return due;
}

export async function runLedgerFeed(deps: IngestDeps, feed: LedgerFeed, options: { limit?: number } = {}): Promise<FeedRunResult> {
  const limit = Math.max(1, options.limit ?? 50);
  const cursor = await readCursor(deps.db, feed.id);
  const result = emptyResult(feed.id, cursor);
  const runnable = feedRunnable(feed, deps.lookup);
  if (!runnable.ok) return { ...result, status: "skipped", reason: runnable.reason };
  if (feed.discovery.type === "openalex") return runOpenAlexFeed(deps, feed, limit, result);

  const all = feed.discovery.type === "sitemap" ? await discoverSitemapUrls(deps, feed) : discoverFixedUrls(feed);
  const candidates = all.filter((url) => url > cursor);
  const now = nowSeconds(deps);
  let position = cursor;
  let index = 0;
  while (index < candidates.length && result.fetched < limit) {
    const group = candidates.slice(index, index + 50);
    const known = await dueMap(deps.db, group);
    for (const url of group) {
      if (result.fetched >= limit) break;
      index += 1;
      position = url;
      const next = known.get(url);
      if (next !== undefined && next !== null && next > now) continue; // not due yet: no fetch
      result.fetched += 1;
      tally(result, await processLedgerUrl(deps, feed, url));
      await writeCursor(deps, feed.id, position);
    }
  }
  result.exhausted = index >= candidates.length;

  // Sources that are due again but no longer in the discovery list.
  if (result.fetched < limit) {
    const due = await deps.db
      .prepare("SELECT normalized_url FROM encyclopedia_sources WHERE feed_id = ?1 AND next_check_at <= ?2 ORDER BY next_check_at, id LIMIT ?3")
      .bind(feed.id, now, limit - result.fetched)
      .all<{ normalized_url: string }>();
    for (const row of due.results) {
      result.fetched += 1;
      tally(result, await processLedgerUrl(deps, feed, row.normalized_url));
    }
  }

  result.cursorAfter = result.exhausted ? "" : position;
  await writeCursor(deps, feed.id, result.cursorAfter);
  await recordDiscoverRun(deps, feed, result);
  return result;
}

/* ---------- OpenAlex ---------- */

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  type?: string | null;
  language?: string | null;
  publication_date?: string | null;
  authorships?: Array<{ author?: { display_name?: string } }>;
  best_oa_location?: { license?: string | null; source?: { display_name?: string } | null } | null;
  primary_location?: { license?: string | null; source?: { display_name?: string } | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

/* OpenAlex names a licence family without a version. The versioned id the policy needs is assumed (CC BY 4.0);
 * every CC BY version allows commercial reuse with credit, which the source section supplies. A human reviewer
 * of the OpenAlex publisher record confirms this assumption before the feed is enabled. */
const OPENALEX_LICENSES: Record<string, { license: string; licenseUrl: string }> = {
  cc0: { license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" },
  "cc-by": { license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
  "public-domain": { license: "PUBLIC-DOMAIN", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" },
};

export function openAlexAbstract(index: Record<string, number[]> | null | undefined) {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) words[position] = word;
  return words.filter((word) => word !== undefined).join(" ").trim();
}

const WORK_TYPES: Record<string, string> = { preprint: "preprint", review: "review", dataset: "dataset" };

export async function processOpenAlexWork(deps: IngestDeps, feed: LedgerFeed, work: OpenAlexWork): Promise<PageOutcome & { bibliographicOnly?: boolean }> {
  if (!work.id || !/^https:\/\/openalex\.org\/W\d+$/u.test(work.id)) return { outcome: "rejected", reason: "invalid-work-id" };
  const title = (work.title ?? work.display_name ?? "").trim();
  if (!title) return { outcome: "rejected", reason: "no-title" };
  const now = new Date(nowSeconds(deps) * 1000).toISOString();
  const doi = work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//iu, "") : null;
  const licenseKey = (work.best_oa_location?.license ?? work.primary_location?.license ?? "").toLowerCase();
  const workLicense = OPENALEX_LICENSES[licenseKey];
  const abstract = openAlexAbstract(work.abstract_inverted_index);
  const admission = workLicense && abstract ? admitLedgerUrl(feed, work.id, deps.lookup, workLicense) : null;
  const usable = Boolean(admission?.admitted);
  const authors = (work.authorships ?? []).map((entry) => entry.author?.display_name ?? "").filter(Boolean);

  // The bibliographic row is kept whatever the licence of the abstract is.
  await deps.db
    .prepare(
      "INSERT OR IGNORE INTO hubpedia_research_works (id, work_type, title, abstract, canonical_url, doi, authors_json, publisher, published_at, peer_review_state, evidence_type, license_name, license_url, content_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'unknown', 'other', ?10, ?11, ?12, ?13, ?13)",
    )
    .bind(`openalex:${work.id.slice(work.id.lastIndexOf("/") + 1)}`, WORK_TYPES[work.type ?? ""] ?? "paper", title, usable ? abstract : null, doi ? `https://doi.org/${doi}` : work.id, doi, JSON.stringify(authors), work.best_oa_location?.source?.display_name ?? work.primary_location?.source?.display_name ?? null, work.publication_date ?? null, usable ? workLicense.license : licenseKey || null, usable ? workLicense.licenseUrl : null, usable ? sha256(`${title}\n\n${abstract}`) : null, now)
    .run();

  if (!admission || !admission.admitted) return { outcome: "skipped", reason: "bibliographic-only" };
  const published = work.publication_date ? new Date(work.publication_date) : null;
  return storePage(deps, {
    feed,
    admission,
    url: work.id,
    title,
    language: work.language ?? null,
    publishedAt: published && Number.isFinite(published.getTime()) ? published : null,
    authors,
    doi,
    mimeType: "text/plain",
    text: `${title}\n\n${abstract}`,
    headings: [],
    minChars: ABSTRACT_MIN_CHARS,
    extraMetadata: { openAlexLicense: licenseKey, licenseVersionAssumed: true },
  });
}

async function runOpenAlexFeed(deps: IngestDeps, feed: LedgerFeed, limit: number, result: FeedRunResult): Promise<FeedRunResult> {
  if (feed.discovery.type !== "openalex") return result;
  let cursor = result.cursorBefore;
  while (result.fetched < limit) {
    const perPage = Math.min(50, limit - result.fetched);
    const url = `https://api.openalex.org/works?filter=${feed.discovery.filter}&per-page=${perPage}&cursor=${encodeURIComponent(cursor || "*")}`;
    const body = (await deps.fetchJson(url)) as { results?: OpenAlexWork[]; meta?: { next_cursor?: string | null } };
    const works = body.results ?? [];
    for (const work of works) {
      result.fetched += 1;
      const outcome = await processOpenAlexWork(deps, feed, work);
      if (outcome.outcome === "skipped" && outcome.reason === "bibliographic-only") result.bibliographicOnly += 1;
      tally(result, outcome);
    }
    const next = body.meta?.next_cursor ?? null;
    if (!next || works.length === 0) {
      cursor = "";
      result.exhausted = true;
      await writeCursor(deps, feed.id, cursor);
      break;
    }
    cursor = next;
    await writeCursor(deps, feed.id, cursor);
  }
  result.cursorAfter = cursor;
  await recordDiscoverRun(deps, feed, result);
  return result;
}

/* ---------- all feeds ---------- */

export async function runLedgerIngest(
  deps: IngestDeps,
  feeds: readonly LedgerFeed[],
  options: { limit?: number; analyzeThreshold?: number } = {},
) {
  const results: FeedRunResult[] = [];
  for (const feed of feeds) results.push(await runLedgerFeed(deps, feed, { limit: options.limit }));
  const chunksInserted = results.reduce((sum, entry) => sum + entry.chunksInserted, 0);
  // One ANALYZE after a bulk load, so the query planner sees the new table sizes.
  const analyzed = chunksInserted >= (options.analyzeThreshold ?? LEDGER_ANALYZE_THRESHOLD);
  if (analyzed) await deps.db.prepare("ANALYZE").run();
  return { results, chunksInserted, analyzed };
}
