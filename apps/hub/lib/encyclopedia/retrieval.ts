import type { D1Database } from "@cloudflare/workers-types";

import { getInstanceOrigin } from "@/lib/instance-origin";
import { likeSpellingBindings } from "@/lib/server/fts-trigram";
import { readVerifiedObject, type LedgerObjectStore } from "./ledger/object-store";
import { wikipediaSlug } from "./wikipedia/constants";

/*
 * Retrieval for "ask Hubpedia" (2026-10-30, owner request). Returns passages an answering tool may cite:
 *  - claims of published, approved, eligible ledger/article revisions (the same visibility predicate as the public reader);
 *  - paragraphs of imported Japanese Wikipedia articles (CC BY-SA 4.0, always unverified until ledger review).
 * Nothing here reads gated content, drafts or unapproved revisions. Every failure yields fewer items, never guesses.
 *
 * D1 reads per call (worst case, the caller adds 2 for the rate limit):
 *   1 query  approved-article candidates: scans at most CANDIDATE_APPROVAL_SCAN (2000) newest active approvals, <= 6 rows out
 *   1 query  claims of those revisions: <= CLAIM_ROW_CAP (150) rows, one correlated evidence lookup each
 *   1-3 queries  Wikipedia catalog by slug / alias: <= 8 + 8 + 8 rows
 *   R2: <= 2 object reads (hash-verified)
 * The article scan has no FTS yet (hubpedia_articles_fts covers only the legacy table); a claim FTS needs a migration.
 */

export const RETRIEVE_VERSION = 1;
export const MAX_QUERY_CHARS = 200;
export const MAX_LIMIT = 12;
export const DEFAULT_LIMIT = 6;
const CANDIDATE_APPROVAL_SCAN = 2000;
const CANDIDATE_ARTICLES = 6;
const CLAIM_ROW_CAP = 150;
const MAX_TERMS = 6;
const MAX_WIKI_ARTICLES = 2;
const MAX_WIKI_PARAGRAPHS = 3;
const PASSAGE_CHARS = 400;
const QUOTE_CHARS = 160;

export type RetrievalStatus = "verified" | "needs_review" | "unverified";

export interface RetrievedClaim {
  kind: "claim";
  id: string;
  text: string;
  title: string;
  url: string;
  source: { url: string; publisher: string; quote?: string };
  status: RetrievalStatus;
}

export interface RetrievedWikipedia {
  kind: "wikipedia";
  id: string;
  text: string;
  title: string;
  url: string;
  source: { url: string; historyUrl: string; licence: "CC-BY-SA-4.0"; publisher: string };
  status: RetrievalStatus;
}

export type RetrievedItem = RetrievedClaim | RetrievedWikipedia;

/* ---------- text helpers (kana folding is consistent with lib/server/fts-trigram.ts) ---------- */

export function foldKana(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・_-]+/gu, "");
}

const QUESTION_TAILS = /(とは何(ですか|か)?|とは(どういう|どんな)?(もの|こと)?(ですか|か)?|について(教えて(ください|ほしい)?|知りたい|説明して(ください)?)?|を教えて(ください)?|って何|は何ですか|は何|はなに|なんですか|ですか|でしょうか|ください|教えて|説明して|知りたい)/gu;
const SPLITTERS = /[\s、。，．,.!?！？「」『』（）()[\]{}:;；:：\/\\"'`]+|(?<=[\p{Script=Han}\p{Script=Katakana}\p{Script=Latin}ー\d])(?:は|が|を|に|で|と|の|も|や|へ|から|まで|より|って)(?=[\p{Script=Han}\p{Script=Katakana}\p{Script=Latin}\d])/gu;

/** Content terms of a question: question tails stripped, split on particles and punctuation. At most MAX_TERMS, each 2+ characters. */
export function queryTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").trim().slice(0, MAX_QUERY_CHARS).replace(QUESTION_TAILS, " ");
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of normalized.split(SPLITTERS)) {
    let term = raw.trim();
    const stripped = term.replace(/^[はがをにでとのもやへ]+|[はがをにでとのもやへ]+$/gu, "");
    if ([...stripped].length >= 2) term = stripped;
    if ([...term].length < 2) continue;
    const key = foldKana(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

function trigrams(folded: string): Set<string> {
  const chars = [...folded];
  const out = new Set<string>();
  if (chars.length < 3) { if (chars.length) out.add(chars.join("")); return out; }
  for (let i = 0; i + 3 <= chars.length; i += 1) out.add(chars.slice(i, i + 3).join(""));
  return out;
}

/** 0..1: mean over terms of (1 if the folded term occurs in the text, else the share of its trigrams that do). */
export function overlapScore(terms: readonly string[], text: string): number {
  if (!terms.length) return 0;
  const folded = foldKana(text);
  const textGrams = trigrams(folded);
  let total = 0;
  for (const term of terms) {
    const f = foldKana(term);
    if (!f) continue;
    if (folded.includes(f)) { total += 1; continue; }
    const grams = trigrams(f);
    if (!grams.size) continue;
    let hit = 0;
    for (const gram of grams) if (textGrams.has(gram)) hit += 1;
    total += (hit / grams.size) * 0.5; // a partial trigram match counts for less than an exact occurrence
  }
  return total / terms.length;
}

function clip(text: string, max: number): string {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join("");
  const head = chars.slice(0, max).join("");
  const stop = head.lastIndexOf("。");
  return stop >= max * 0.5 ? head.slice(0, stop + 1) : `${head}…`;
}

const httpUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null; } catch { return null; }
};

const hubArticleUrl = (slug: string) => `${getInstanceOrigin()}/v2/hubpedia/${encodeURIComponent(slug)}`;

/** Picks the best paragraphs of an imported body by term overlap; a title hit with no body overlap yields the lead. */
export function pickParagraphs(body: string, terms: readonly string[], max = MAX_WIKI_PARAGRAPHS): string[] {
  const paragraphs = body.split(/\n{2,}/u).map((p) => p.trim()).filter((p) => [...p].length >= 20 && !p.startsWith("#"));
  const scored = paragraphs.map((text, index) => ({ text, index, score: overlapScore(terms, text) + (index === 0 ? 0.05 : 0) }));
  const hits = scored.filter((p) => p.score > 0.05).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, max);
  const chosen = hits.length ? hits : scored.slice(0, 1);
  return chosen.sort((a, b) => a.index - b.index).map((p) => clip(p.text, PASSAGE_CHARS));
}

/* ---------- ledger claims ---------- */

type ArticleRow = { slug: string; revision_id: string; title: string };
type ClaimRow = { id: string; statement: string; knowledge_status: string | null; revision_id: string; ev: string | null };

const VISIBLE_ARTICLES = `
  FROM (SELECT article_slug, approved_revision_key FROM hubpedia_publication_approvals WHERE revoked_at IS NULL ORDER BY approved_at DESC LIMIT ${CANDIDATE_APPROVAL_SCAN}) ap
  JOIN encyclopedia_articles a ON a.slug = ap.article_slug
  JOIN encyclopedia_article_revisions r ON r.id = a.current_revision_id
  WHERE a.status = 'published'
    AND ap.approved_revision_key = 'db:' || r.revision_number
    AND EXISTS (SELECT 1 FROM hubpedia_publication_eligible_articles eligible WHERE eligible.article_slug = a.slug AND eligible.revision_id = a.current_revision_id)`;

function mapStatus(knowledge: string | null): RetrievalStatus {
  if (knowledge === "established" || knowledge === "strong-evidence") return "verified";
  if (knowledge === "unverified") return "unverified";
  return "needs_review"; // provisional, or approved with no recorded knowledge state
}

export async function retrieveClaims(db: D1Database, terms: readonly string[]): Promise<Array<RetrievedClaim & { score: number }>> {
  if (!terms.length) return [];
  const likes = likeSpellingBindings([...terms]);
  const condition = terms.map(() => "(lower(r.title) LIKE ? ESCAPE '\\' OR lower(r.title) LIKE ? ESCAPE '\\' OR lower(coalesce(r.summary,'')) LIKE ? ESCAPE '\\' OR lower(coalesce(r.summary,'')) LIKE ? ESCAPE '\\')").join(" OR ");
  const bindings = terms.flatMap((_, i) => { const [h, k] = [likes[i * 2], likes[i * 2 + 1]]; return [h, k, h, k]; });
  const articles = (await db.prepare(`SELECT a.slug AS slug, r.id AS revision_id, r.title AS title ${VISIBLE_ARTICLES} AND (${condition}) ORDER BY a.updated_at DESC LIMIT ${CANDIDATE_ARTICLES}`).bind(...bindings).all<ArticleRow>()).results;
  if (!articles.length) return [];
  const marks = articles.map(() => "?").join(",");
  const rows = (await db.prepare(
    `SELECT c.id AS id, c.statement AS statement, ks.knowledge_status AS knowledge_status, rc.revision_id AS revision_id,
       (SELECT coalesce(e.quote,'') || char(31) || s.url || char(31) || coalesce(s.publisher, s.title, '')
          FROM encyclopedia_claim_evidence e
          JOIN encyclopedia_source_chunks ch ON ch.id = e.chunk_id
          JOIN encyclopedia_source_snapshots sn ON sn.id = ch.snapshot_id
          JOIN encyclopedia_sources s ON s.id = sn.source_id
         WHERE e.claim_id = c.id AND e.stance = 'supports' AND e.superseded_at IS NULL AND s.is_active
         ORDER BY e.relevance DESC LIMIT 1) AS ev
     FROM encyclopedia_revision_claims rc
     JOIN encyclopedia_claims c ON c.id = rc.claim_id
     LEFT JOIN hubpedia_claim_knowledge_state ks ON ks.claim_id = c.id
     WHERE rc.revision_id IN (${marks}) AND c.status = 'supported' AND c.merged_into_claim_id IS NULL
       AND (ks.knowledge_status IS NULL OR ks.knowledge_status NOT IN ('disputed','refuted'))
     ORDER BY rc.revision_id, rc.citation_index LIMIT ${CLAIM_ROW_CAP}`,
  ).bind(...articles.map((a) => a.revision_id)).all<ClaimRow>()).results;
  const byRevision = new Map(articles.map((a) => [a.revision_id, a]));
  const out: Array<RetrievedClaim & { score: number }> = [];
  for (const row of rows) {
    const article = byRevision.get(row.revision_id);
    if (!article || !row.ev) continue;
    const [quote, rawUrl, publisher] = row.ev.split("\u001f");
    const sourceUrl = httpUrl(rawUrl);
    if (!sourceUrl) continue; // a claim with no usable source is not citable
    const score = overlapScore(terms, row.statement);
    if (score <= 0) continue;
    const item: RetrievedClaim & { score: number } = {
      kind: "claim", id: `claim:${row.id}`, text: clip(row.statement, PASSAGE_CHARS), title: article.title, url: hubArticleUrl(article.slug),
      source: { url: sourceUrl, publisher: publisher || new URL(sourceUrl).hostname, ...(quote ? { quote: clip(quote, QUOTE_CHARS) } : {}) },
      status: mapStatus(row.knowledge_status), score,
    };
    out.push(item);
  }
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

/* ---------- Japanese Wikipedia base layer ---------- */

type WikiRow = { slug: string; title: string; body_object_key: string; body_sha256: string; source_url: string; history_url: string; verification_status: string };

export async function retrieveWikipedia(db: D1Database, objects: LedgerObjectStore | undefined, terms: readonly string[], queryText: string): Promise<RetrievedWikipedia[]> {
  if (!objects || !terms.length) return [];
  const candidates = [...new Set([...terms, queryText.normalize("NFKC").replace(QUESTION_TAILS, "").trim()].filter((t) => [...t].length >= 2 && [...t].length <= 60).map(wikipediaSlug))].slice(0, 8);
  if (!candidates.length) return [];
  const marks = candidates.map(() => "?").join(",");
  const columns = "slug, title, body_object_key, body_sha256, source_url, history_url, verification_status";
  const direct = (await db.prepare(`SELECT ${columns} FROM hubpedia_wikipedia_articles WHERE slug IN (${marks}) AND verification_status <> 'superseded' LIMIT 8`).bind(...candidates).all<WikiRow>()).results;
  const found = new Map(direct.map((row) => [row.slug, row]));
  const aliases = (await db.prepare(`SELECT target_slug FROM hubpedia_wikipedia_aliases WHERE alias_slug IN (${marks}) LIMIT 8`).bind(...candidates).all<{ target_slug: string }>()).results;
  const missing = [...new Set(aliases.map((a) => a.target_slug))].filter((slug) => !found.has(slug)).slice(0, 8);
  if (missing.length) {
    const more = (await db.prepare(`SELECT ${columns} FROM hubpedia_wikipedia_articles WHERE slug IN (${missing.map(() => "?").join(",")}) AND verification_status <> 'superseded' LIMIT 8`).bind(...missing).all<WikiRow>()).results;
    for (const row of more) found.set(row.slug, row);
  }
  const ranked = [...found.values()].sort((a, b) => overlapScore(terms, b.title) - overlapScore(terms, a.title) || (a.slug < b.slug ? -1 : 1)).slice(0, MAX_WIKI_ARTICLES);
  const items: RetrievedWikipedia[] = [];
  for (const row of ranked) {
    const pageUrl = httpUrl(row.source_url), historyUrl = httpUrl(row.history_url);
    if (!pageUrl || !historyUrl) continue;
    let body: string;
    try { body = await readVerifiedObject(objects, { key: row.body_object_key, sha256: row.body_sha256 }); } catch { continue; } // fail closed per article
    pickParagraphs(body, terms).forEach((text, index) => {
      items.push({
        kind: "wikipedia", id: `wikipedia:${row.slug}#${index + 1}`, text, title: row.title, url: hubArticleUrl(row.slug),
        source: { url: pageUrl, historyUrl, licence: "CC-BY-SA-4.0", publisher: "日本語版ウィキペディア" },
        status: row.verification_status === "verified" ? "verified" : "unverified",
      });
    });
  }
  return items;
}

/* ---------- entry point ---------- */

export function clampLimit(raw: string | null): number {
  const n = Math.floor(Number(raw ?? DEFAULT_LIMIT));
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_LIMIT, n)) : DEFAULT_LIMIT;
}

/** Claims first (they carry a primary source), then Wikipedia passages. Any failure of a layer drops that layer only. */
export async function retrieveForQuestion(db: D1Database, objects: LedgerObjectStore | undefined, query: string, limit: number): Promise<RetrievedItem[]> {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const [claims, wiki] = await Promise.all([
    retrieveClaims(db, terms).catch(() => []),
    retrieveWikipedia(db, objects, terms, query).catch(() => []),
  ]);
  const claimItems: RetrievedItem[] = claims.map(({ score: _score, ...item }) => item);
  return [...claimItems, ...wiki].slice(0, limit);
}
